const process = require('process');

class Archwayd {
    constructor(options) {
        this.logger = options.logger;

        this.project_id = options.project_id;
        this.chain_id = options.chain_id;
        this.accounts = [];

        this.Docker = options.docker;
        this.docker = this.Docker.docker;
        this.image = options.docker.image;
        this.volume = options.docker.volume;
        this.docker_opts = {
            NetworkDisabled: true,
            HostConfig: {
                AutoRemove: true,
                Mounts: [{
                    source: this.volume,
                    target: '/root/.archway',
                    type: 'volume'
                }]
            }
        };
    }

    async init_genesis() {
        this.logger.app(`Generating genesis file for ${this.chain_id}...`);
        await this.docker.run(this.image, [
            'init', this.project_id,
            '--chain-id', this.chain_id
        ], undefined, this.docker_opts);
    }

    async generate_accounts(num_accounts, balance) {
        const logger = this.logger;
        const docker = this.docker;
        const image = this.image;
        const accounts = this.accounts;
        const docker_opts = this.docker_opts;

        logger.app(`Generating ${num_accounts} accounts...`);
        for (let i = 0; i < num_accounts; i++) {
            await new Promise(function(resolve, reject) {
                docker.run(image, [
                        'keys', 'add', `${i}`,
                        '--keyring-backend', 'test',
                        '--output', 'json'
                    ], undefined, docker_opts, function(err) {
                        if (err) {
                            return reject(err);
                        }
                        return resolve();
                    })
                    .on('stream', function(stream) {
                        stream.on('data', function(data) {
                            const json = data.toString();
                            accounts.push(JSON.parse(json));
                        });
                    });
            });
        }

        logger.app(`Adding ${num_accounts} accounts to the genesis file...`);
        for (let i = 0; i < num_accounts; i++) {
            await new Promise(function(resolve, reject) {
                docker.run(image, [
                        'add-genesis-account', `${i}`, `${balance}stake`,
                        '--keyring-backend', 'test',
                        '--output', 'json'
                    ], undefined, docker_opts, function(err) {
                        if (err) {
                            return reject(err);
                        }
                        return resolve();
                    })
                    .on('stream', function(stream) {
                        stream.on('data', function(data) {
                            logger.docker(data.toString());
                        });
                    });
            });
        }

        logger.app(`Creating validator...`);
        await docker.run(image, [
            'gentx', '0', '100000000stake',
            '--chain-id', this.chain_id,
            '--keyring-backend', 'test',
            '--output', 'json'
        ], undefined, {
            ...docker_opts,
            NetworkDisabled: false
        });

        logger.app(`Collecting gentxs...`);
        await docker.run(image, ['collect-gentxs'], undefined, docker_opts);

        logger.account('Available Accounts');
        logger.account('==================');
        accounts.forEach(function(account, idx) {
            const validator_label = idx === 0 ? ' (validator)' : '';
            logger.account(`(${account.name}) ${account.address} ${balance}stake${validator_label}`);
        });

        logger.account('\nMnemonics');
        logger.account('==================');
        accounts.forEach(function(account) {
            logger.account(`(${account.name}) ${account.mnemonic}`);
        });
    }

    start_node() {
        const logger = this.logger;
        const Docker = this.Docker;
        const docker = this.docker;
        const container_name = 'spinarch_archwayd';

        logger.app(`Starting node... (press Ctrl-C to stop)`);
        docker.run(this.image, [
                'start',
                '--moniker', this.project_id,
                '--minimum-gas-prices', '0stake',
                '--rpc.laddr', 'tcp://0.0.0.0:26657'
            ], undefined, {
                ...this.docker_opts,
                name: container_name,
                NetworkDisabled: false
            }, function(err) {
                if (err) throw err;
            })
            .on('stream', function(stream) {
                stream.on('data', function(data) {
                    logger.docker(data.toString());
                });
            });

        process.on('SIGINT', async function() {
            logger.app('SIGINT received, stopping node...');
            const container = docker.getContainer(container_name);
            await container.stop();
            await Docker.remove_volume();
            logger.app('Bye!');
        });
    }
}

module.exports = Archwayd;

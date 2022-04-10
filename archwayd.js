const fs = require('node:fs');
const fs_async = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');

class Archwayd {
    constructor(options) {
        this.logger = options.logger;

        this.project_id = options.project_id;
        this.project_dir = options.project_dir;
        this.chain_id = options.chain_id;
        this.accounts = [];

        this.is_persistent = this.project_id !== 'spinarch';
        this.reset_state = options.reset_state;

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

        if (this.is_persistent) {
            this.docker_opts.HostConfig.Mounts = [{
                source: this.project_dir,
                target: '/root/.archway',
                type: 'bind'
            }];
        }
    }

    async load_config() {
        if (!this.is_persistent) return;

        try {
            const accounts = JSON.parse(await fs_async.readFile(path.resolve(this.project_dir, 'spinarch_accounts.json')));
            if (accounts.length > 0) this.accounts = accounts;
        } catch (err) {
            this.logger.app('Creating new config...');
        }
    }

    async init_genesis() {
        try {
            const genesis_path = path.resolve(this.project_dir, 'config', 'genesis.json');
            await fs_async.access(genesis_path, fs.constants.F_OK);
        } catch (err) {
            this.logger.app(`Generating genesis file for ${this.chain_id}...`);
            await this.docker.run(this.image, [
                'init', this.project_id,
                '--chain-id', this.chain_id
            ], undefined, this.docker_opts);
        }
    }

    display_accounts(accounts) {
        const logger = this.logger;

        logger.account('Available Accounts');
        logger.account('==================');
        accounts.forEach(function(account, idx) {
            const validator_label = idx === 0 ? ' (validator)' : '';
            logger.account(`(${account.name}) ${account.address} ${validator_label}`);
        });

        logger.account('\nMnemonics');
        logger.account('==================');
        accounts.forEach(function(account) {
            logger.account(`(${account.name}) ${account.mnemonic}`);
        });
    }

    async generate_accounts(num_accounts, balance) {
        if (this.accounts.length > 0) {
            this.display_accounts(this.accounts);
            return;
        }

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

        await fs.writeFile(path.resolve(this.project_dir, 'spinarch_accounts.json'), JSON.stringify(accounts));

        this.display_accounts(accounts);
    }

    async start_node() {
        const logger = this.logger;
        const Docker = this.Docker;
        const docker = this.docker;
        const container_name = 'spinarch_archwayd';

        if (this.is_persistent && this.reset_state) {
            logger.app(`Resetting state to the genesis...`);
            await docker.run(this.image, ['unsafe-reset-all'], undefined, this.docker_opts);
        }

        logger.app(`Starting node... (RPC on 127.0.0.1:26657)`);
        logger.app(`<Press Ctrl-C to stop>`);
        const docker_opts = {
            ...this.docker_opts,
            name: container_name,
            NetworkDisabled: false
        };
        docker_opts.HostConfig.PortBindings = {
            '26657/tcp': [{
                HostIp: '127.0.0.1',
                HostPort: '26657'
            }]
        };
        docker.run(this.image, [
                'start',
                '--moniker', this.project_id,
                '--minimum-gas-prices', '0stake',
                '--rpc.laddr', 'tcp://0.0.0.0:26657'
            ], undefined, docker_opts, function(err) {
                if (err) throw err;
            })
            .on('stream', function(stream) {
                stream.on('data', function(data) {
                    logger.docker(data.toString());
                });
            });

        const is_persistent = this.is_persistent;
        process.on('SIGINT', async function() {
            logger.app('SIGINT received, stopping node...');
            const container = docker.getContainer(container_name);
            await container.stop();
            if (!is_persistent) await Docker.remove_volume();
            logger.app('Bye!');
        });
    }
}

module.exports = Archwayd;

const child_process = require('node:child_process');
const fs = require('node:fs');
const fs_async = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const date_fns = require('date-fns');
const mkdirp = require('mkdirp');

class Archwayd {
    constructor(options) {
        this.logger = options.logger;

        this.project_id = options.project_id;
        this.project_dir = options.project_dir;
        this.chain_id = options.chain_id;
        this.accounts = [];

        this.is_persistent = options.is_persistent;
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

        this.bin_dir = path.resolve(__dirname, 'bin');
        this.is_apple_silicon = process.platform === 'darwin' && process.arch === 'arm64';
        this.pid = null;

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

        if (this.is_persistent) {
            await fs_async.writeFile(path.resolve(this.project_dir, 'spinarch_accounts.json'), JSON.stringify(accounts));
        }

        this.display_accounts(accounts);
    }

    async start_node() {
        const logger = this.logger;
        const docker = this.docker;
        const container_name = 'spinarch_archwayd';

        if (this.is_persistent && this.reset_state) {
            logger.app(`Resetting state to the genesis...`);
            await docker.run(this.image, ['unsafe-reset-all'], undefined, this.docker_opts);
        }

        logger.app(`Starting node... (RPC on 127.0.0.1:26657)`);
        if (this.is_apple_silicon && this.is_persistent) {
            const cp = child_process.spawn(`${this.bin_dir}/archwayd-darwin-arm64`, [
                'start',
                '--moniker', this.project_id,
                '--minimum-gas-prices', '0stake',
                '--rpc.laddr', 'tcp://127.0.0.1:26657',
                '--home', this.project_dir
            ]);

            this.pid = cp.pid;

            cp.stdout.on('data', function(data) {
                logger.docker(data.toString().trim());
            });

            cp.stderr.on('data', function(data) {
                logger.docker(data.toString().trim());
            });

            cp.on('error', function(err) {
                logger.app('Failed to spawn child process');
                logger.docker(err);
            });

            cp.on('close', function(code) {
                logger.app(`Child process exited with code ${code}`);
                this.pid = null;
            });
        } else {
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
                        logger.docker(data.toString().trim());
                    });
                });
        }

        if (this.is_persistent) {
            logger.app('<Press Ctrl-S to take snapshot, Ctrl-C to stop node>');
        } else {
            logger.app('<Press Ctrl-C to stop node>');
        }
    }

    async stop_node() {
        if (this.pid) {
            process.kill(this.pid, 'SIGINT');
            return;
        }

        const container = this.docker.getContainer('spinarch_archwayd');
        await container.stop();
        if (!this.is_persistent) await this.Docker.remove_volume();
    }

    async snapshot() {
        if (!this.is_persistent) return;

        try {
            this.logger.app('Taking snapshot...');

            await this.stop_node();

            const snapshot_path = path.resolve(this.project_dir, '..', '.snapshots');
            const snapshot_name = `${this.project_id}_${date_fns.format(new Date(), 'yyyy-MM-dd_HHmmss')}`;
            await mkdirp(snapshot_path);

            const docker = this.docker;
            const logger = this.logger;
            const project_dir = this.project_dir;
            await new Promise(function(resolve, reject) {
                docker.run('alpine:latest', [
                        'tar', 'cvf', `/ss/${snapshot_name}.tar`, '/state'
                    ], undefined, {
                        NetworkDisabled: true,
                        HostConfig: {
                            AutoRemove: true,
                            Mounts: [{
                                source: snapshot_path,
                                target: '/ss',
                                type: 'bind'
                            }, {
                                source: project_dir,
                                target: '/state',
                                type: 'bind'
                            }]
                        }
                    }, function(err) {
                        if (err) return reject(err);
                        resolve();
                    })
                    .on('stream', function(stream) {
                        stream.on('data', function(data) {
                            logger.docker(data.toString().trim());
                        });
                    });
            });
            this.logger.app(`\nSnapshot saved to ${snapshot_path}/${snapshot_name}.tar\n`);
        } catch (err) {
            this.logger.app('Failed to take snapshot');
        }

        await this.start_node(); // Resume node
    }

    async restore(snapshot_name) {
        if (!this.is_persistent) return;

        try {
            const snapshot_path = path.resolve(this.project_dir, '..', '.snapshots');

            const docker = this.docker;
            const logger = this.logger;
            const project_dir = this.project_dir;
            await new Promise(function(resolve, reject) {
                docker.run('alpine:latest', [
                        'sh', '-c',
                        `rm -r /state/* && cd / && tar xvf /ss/${snapshot_name}`
                    ], undefined, {
                        NetworkDisabled: true,
                        HostConfig: {
                            AutoRemove: true,
                            Mounts: [{
                                source: snapshot_path,
                                target: '/ss',
                                type: 'bind'
                            }, {
                                source: project_dir,
                                target: '/state',
                                type: 'bind'
                            }]
                        }
                    }, function(err) {
                        if (err) return reject(err);
                        resolve();
                    })
                    .on('stream', function(stream) {
                        stream.on('data', function(data) {
                            logger.docker(data.toString().trim());
                        });
                    });
            });
            this.logger.app(`Snapshot restored to ${this.project_dir}`);
        } catch (err) {
            this.logger.app('Failed to restore snapshot');
        }
    }
}

module.exports = Archwayd;

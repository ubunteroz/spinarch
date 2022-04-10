#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const blessed = require('blessed');
const {
    program,
    Option
} = require('commander');
const docker_names = require('docker-names');
const mkdirp = require('mkdirp');
const package = require('./package.json');

program
    .name(package.name)
    .description(package.description)
    .version(package.version);

program
    .addOption(new Option('--project-id <string>', 'Your project ID'))
    .addOption(new Option('--chain-id <string>', 'Chain ID').default('spinarch-1'))
    .addOption(new Option('--num-accounts <number>', 'Number of accounts to generate').default(10))
    .addOption(new Option('--balance <number>', 'Default balance of each generated account').default(1000000000))
    .addOption(new Option('--update-image', 'Update the Archway image to latest version'))
    .addOption(new Option('--reset-state', 'Reset the blockchain to the genesis state'));

program.parse();

(async function() {
    const options = program.opts();
    const project_id = options.projectId || docker_names.getRandomName();
    const project_dir = path.resolve(os.homedir(), '.spinarch', project_id);
    const is_persistent = !!options.projectId;

    if (options.numAccounts < 1) {
        console.error('Number of accounts to generate must be greater than 0');
        process.exit(1);
    }

    // BLESSED TUI
    const screen = blessed.screen({
        smartCSR: true,
        dockBorders: true,
        fullUnicode: true,
        title: `🥬 ${package.name} ${package.version} - ${project_id}`
    });
    // APPLICATION LOG
    const box_top_left = blessed.log({
        parent: screen,
        top: 0,
        left: 0,
        width: '50%',
        height: '50%',
        border: {
            type: 'line'
        },
        mouse: true,
        scrollback: 100,
        scrollbar: {
            ch: ' ',
            track: {
                bg: 'green'
            },
            style: {
                inverse: true
            }
        }
    });
    // DOCKER LOG
    const box_top_right = blessed.log({
        parent: screen,
        top: 0,
        left: '50%',
        width: '50%',
        height: '50%',
        border: {
            type: 'line'
        },
        mouse: true,
        scrollback: 100,
        scrollbar: {
            ch: ' ',
            track: {
                bg: 'red'
            },
            style: {
                inverse: true
            }
        }
    });
    // ACCOUNT LOG
    const box_bottom = blessed.log({
        parent: screen,
        top: '50%',
        left: 0,
        width: '100%',
        height: '50%',
        border: {
            type: 'line'
        },
        mouse: true,
        scrollback: 100,
        scrollbar: {
            ch: ' ',
            track: {
                bg: 'yellow'
            },
            style: {
                inverse: true
            }
        }
    });
    // LOGGER
    const logger = {
        app: function(string) {
            box_top_left.log(string);
            screen.render();
        },
        docker: function(string) {
            box_top_right.log(string);
            screen.render();
        },
        account: function(string) {
            box_bottom.log(string);
            screen.render();
        }
    };

    logger.docker(await fs.readFile('./spinach.txt', 'utf8')); // 🥬
    box_bottom.focus();
    screen.render();

    let is_stopped = false;
    screen.key(['C-c'], function() {
        if (is_stopped) return;
        process.kill(process.pid, 'SIGINT');
        is_stopped = true;
    });

    process.on('SIGINT', function() {
        setTimeout(function() {
            screen.destroy();
        }, 2000);
    });
    //- END: BLESSED TUI

    const Docker = require('./docker');
    const docker = new Docker({
        logger: logger
    });

    const Archwayd = require('./archwayd');
    const archwayd = new Archwayd({
        logger: logger,
        docker: docker,
        project_id: project_id,
        project_dir: project_dir,
        chain_id: options.chainId,
        is_persistent: is_persistent,
        reset_state: options.resetState
    });

    if (!is_persistent) {
        logger.app(`Starting with temporary state... (set --project-id to enable persistent state)`);
        await docker.remove_volume();
    } else {
        logger.app(`Starting with persistent state... (${project_dir})`);
        await mkdirp(project_dir);
    }

    if (!(await docker.image_exists()) || options.updateImage) {
        await docker.pull_image();
    }
    await archwayd.load_config();
    await archwayd.init_genesis();
    await archwayd.generate_accounts(options.numAccounts, options.balance);
    await archwayd.start_node();
})();

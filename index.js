#!/usr/bin/env node

const fs_async = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const blessed = require('neo-blessed');
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
    const project_id = options.projectId ? options.projectId.replace(/[^0-9a-zA-Z-_]/g, '') : docker_names.getRandomName();
    const project_dir = path.resolve(os.homedir(), '.spinarch', project_id);
    const snapshot_dir = path.resolve(project_dir, '..', '.snapshots');
    const is_persistent = !!options.projectId;

    if (options.numAccounts < 1) {
        console.error('Number of accounts to generate must be greater than 0');
        process.exit(1);
    }

    //- Start: Choose snapshot
    await mkdirp(snapshot_dir);
    const snapshots = (await fs_async.readdir(snapshot_dir))
        .filter(function(snapshot) {
            return snapshot.startsWith(project_id + '_') && snapshot.endsWith('.tar');
        })
        .sort()
        .reverse()
        .slice(0, 10); // Return max 10 snapshots

    let selected_snapshot = 'CURRENT'; // CURRENT is current state
    if (snapshots.length > 0) {
        // FIXME: Use blessed to display snapshot selector
    }
    //- End: Choose snapshot

    //- Start: Blessed TUI
    const screen = blessed.screen({
        smartCSR: true,
        dockBorders: true,
        fullUnicode: true,
        title: `🥬 ${package.name} ${package.version} - ${project_id}`
    });
    // Application log
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
    // Docker log
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
    // Accounts log
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
    // Log helper
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

    box_bottom.focus();
    //- End: Blessed TUI

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

    // Hotkey - text selection
    let is_selection_enabled = false;
    screen.key(['C-t'], function() {
        is_selection_enabled = !is_selection_enabled;

        if (is_selection_enabled) {
            screen.program.disableMouse();
            logger.app('> Text selection is now enabled');
        } else {
            screen.program.enableMouse();
            logger.app('> Text selection is now disabled');
        }
    });

    // Hotkey - snapshot
    let is_stopping = false;
    let is_snapshotting = false;
    screen.key(['C-s'], async function() {
        if (is_snapshotting || is_stopping) return;
        is_snapshotting = true;
        await archwayd.snapshot();
        is_snapshotting = false;
    });

    // Hotkey - terminate
    screen.key(['C-c'], function() {
        if (is_snapshotting || is_stopping) return;
        is_stopping = true;
        process.kill(process.pid, 'SIGINT');
    });

    // Handle termination
    process.on('SIGINT', async function() {
        try {
            logger.app('Stopping...');
            await archwayd.stop_node();
        } catch (err) {
            // Ignore
        }

        screen.destroy();
        process.exit(0);
    });

    //- Start: Application flow

    logger.app('<Press Ctrl-T to toggle text selection>');
    logger.docker(await fs_async.readFile(path.resolve(__dirname, 'spinach.txt'), 'utf8')); // 🥬

    if (!is_persistent) {
        logger.app(`Starting with temporary state... (set --project-id to enable persistent state)`);
        await docker.remove_volume();
    } else {
        logger.app(`Starting with persistent state... (${project_dir})`);
        await mkdirp(project_dir);

        if (selected_snapshot !== 'CURRENT') {
            logger.app(`Restoring snapshot... (${selected_snapshot})`);
            await archwayd.restore(selected_snapshot);
        }
    }

    if (!(await docker.image_exists()) || options.updateImage) {
        await docker.pull_image();
    }
    if (!(await docker.image_exists('alpine:latest'))) {
        await docker.pull_image('alpine:latest');
    }
    await archwayd.load_config();
    await archwayd.init_genesis();
    await archwayd.generate_accounts(options.numAccounts, options.balance);
    await archwayd.start_node();
    //- End: Application flow
})();

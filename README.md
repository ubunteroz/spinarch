# 🥬 SpinArch

## About

SpinArch (c) 2022, Surya Handika Putratama <ubunteroz@gmail.com>

**Spin local Archway testnet for faster dApps development**

⚠️ This application is in early development

### Features

- Run persistent/non-persistent local testnet node
- Generate pre-funded accounts
- Take snapshot of running node

## Requirements

- Linux/macOS (not tested on Windows yet)
- Node.js (>= 16) and NPM
- Docker

## Installation

```shell
npm install -g spinarch
```

## Usage

```
Usage: spinarch [options]

🥬 Spin local Archway testnet for faster dApps development 🚀

Options:
  -V, --version            output the version number
  --project-id <string>    Your project ID
  --chain-id <string>      Chain ID (default: "spinarch-1")
  --num-accounts <number>  Number of accounts to generate (default: 10)
  --balance <number>       Default balance of each generated account (default: 1000000000)
  --update-image           Update the Archway image to latest version
  --reset-state            Reset the blockchain to the genesis state
  -h, --help               display help for command
```

### 1. Run a throwaway node

This command will run a temporary, non-persistent Archway node. Node's data will be deleted on exit.

```shell
spinarch
```

### 2. Run a persistent node

Specify a project ID if you want to run a persistent Archway node. Node's data is saved to disk and can be loaded again next time you run SpinArch with the same project ID.

```shell
spinarch --project-id my-dapp
```

### 3. Reset a persistent node

Saved state will be reset to the genesis.

```shell
spinarch --project-id my-dapp --reset-state
```

### 4. Run with custom chain ID

You can run a node with a custom chain ID by specifying `--chain-id` option. This applies to both throwaway and persistent node.

```shell
spinarch --chain-id mainnet-1
```

### 5. Run with N number of prefunded accounts

By default, SpinArch will generate 10 prefunded accounts. You can generate an N number of accounts with B balance by specifying `--num-accounts` and/or `--balance`.

```shell
spinarch --num-accounts 5 --balance 10000000
```

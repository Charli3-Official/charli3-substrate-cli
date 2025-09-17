# Substrate CLI

This CLI app is created to query the substrate node, and submit platform governance transactions.

## Setup

1. Install Node.js LTS and Yarn package manager

2. Install dependencies:

```bash
yarn install
```

3. Copy and configure environment:

```bash
cp config-example.yml config.yml
```

## Development

### Build and run

```bash
# Development
yarn dev

# Production
yarn build && yarn charli3

# Code quality
yarn lint
yarn format
yarn check-types
```

## CLI Commands

### Oracle Configuration Update Tx (could require multisig)

```bash
# Submit new oracle configuration update tx, which may require several steps in case of multisig
yarn charli3 start-config-update -w alice

# Sign oracle configuration update tx, and complete it in case of multisig threshold was reached
yarn charli3 sign-config-update -w bob --tx 0xffff0d3983034ad8097d3723433e5482393afd81953f6e2f56806be5fa11ffff
```

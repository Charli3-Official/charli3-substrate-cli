import { Command } from 'commander';
import { loadTestnetWallet, loadWallet } from '../service/crypto.js';
import type { KeyringPair } from '@polkadot/keyring/types';

export { selectWallet, addWalletAndConfigOptions, addSigningOptions, addNodeOption };

// Helper function to select wallet
async function selectWallet(suriOrName: string): Promise<KeyringPair> {
  if (suriOrName.split(' ').length >= 12) {
    return await loadWallet(suriOrName);
  }
  return await loadTestnetWallet(suriOrName);
}

// Command definitions with shared option builders
function addWalletAndConfigOptions(cmd: Command) {
  return cmd
    .requiredOption(
      '-w, --wallet <string>',
      'String refers to wallet test name, e.g. Alice, or the suri itself',
    )
    .option(
      '-c, --config <path>',
      'YAML file for Multisig and Oracle configurations',
      'testnet-config.yml',
    )
    .option(
      '-s, --substrate-rpc <url>',
      'Web Socket URL for JSON RPC protocol',
      'ws://127.0.0.1:9944',
    );
}

function addSigningOptions(cmd: Command) {
  return cmd.requiredOption('-x, --tx <id>', 'Original multisig start tx hash as an 0x-string');
}

function addNodeOption(cmd: Command, description: string) {
  return cmd.requiredOption('-n, --node <string>', description);
}

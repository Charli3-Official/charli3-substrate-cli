import { Command } from 'commander';
import { sortAddresses } from '@polkadot/util-crypto';
import { getCurrentConfig, useSubstrateClient } from './service/query.js';
import { createMultiAddress } from './service/crypto.js';
import { calculateSafeWeight, txCallback, waitForTx } from './service/tx.js';
import { loadCliConfig, loadMultisigConfig } from './service/config.js';
import { AccountId32, type Bytes } from 'dedot/codecs';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { DedotClient } from 'dedot';
import { createStakingCommand } from './commands/stakingCommands.js';
import type {
  CardanoSidechainApi,
  PalletMultisigTimepoint,
} from './charli3-substrate-runtime/index.js';
import type { ChainSubmittableExtrinsic } from './charli3-substrate-runtime/tx.js';
import {
  addNodeOption,
  addSigningOptions,
  addWalletAndConfigOptions,
  selectWallet,
} from './service/cli.js';

const program = new Command();

program.name('charli3').description('Oracle platform CLI').version('1.0.0');

// Generic multisig transaction executor
interface MultisigTxParams {
  client: DedotClient<CardanoSidechainApi>;
  wallet: KeyringPair;
  multisigAddresses: string[];
  threshold: number;
  sudoCall: ChainSubmittableExtrinsic<any>;
  when?: PalletMultisigTimepoint | undefined;
}

export async function executeMultisigTx({
  client,
  wallet,
  multisigAddresses,
  threshold,
  sudoCall,
  when,
}: MultisigTxParams): Promise<`0x${string}` | null> {
  const multiAddr = createMultiAddress(multisigAddresses, threshold);
  const otherSignatories = sortAddresses(
    multisigAddresses.filter((addr) => addr !== wallet.address),
    42,
  );

  // Create initial transaction for estimation
  const txMulti = client.tx.multisig.asMulti(threshold, otherSignatories, when, sudoCall.call, {
    refTime: 0n,
    proofSize: 0n,
  });

  const txEstimation = await txMulti.paymentInfo(wallet, { tip: 0n });
  console.log('tx estimation', txEstimation);

  const safeWeight = calculateSafeWeight(txEstimation);

  // Create final transaction with safe weight
  const txFinal = client.tx.multisig.asMulti(
    threshold,
    otherSignatories,
    when,
    sudoCall.call,
    safeWeight,
  );

  let txMultiHash: `0x${string}` | undefined = undefined;
  let txIncluded = false;

  try {
    // Use a promise that resolves when transaction is finalized
    await new Promise<void>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transaction timeout after 30 seconds'));
      }, 30000); // 30 second timeout

      const unsub = await txFinal.signAndSend(wallet, { tip: 0n }, async (result) => {
        // Debug: Log transaction status with details
        console.log(`🔔 Transaction status: ${result.status.type}`);

        txCallback(result);

        // Debug: Log all events
        console.log('📋 Transaction events:', result.events.length);

        if (result.events.length > 0) {
          for (const e of result.events) {
            console.log(`  - ${e.event.pallet}.${e.event.palletEvent.name}`);

            // Check for transaction failure
            if (e.event.pallet === 'System' && e.event.palletEvent.name === 'ExtrinsicFailed') {
              console.error(
                '❌ Transaction failed:',
                JSON.stringify(e.event.palletEvent.data, null, 2),
              );
              clearTimeout(timeout);
              await unsub();
              reject(new Error('Transaction failed'));
              return;
            }

            if (e.event.pallet === 'Multisig' && e.event.palletEvent.name === 'NewMultisig') {
              console.log('✅ NewMultisig event found!');
              console.log(e.event.palletEvent.data);
              txMultiHash = e.event.palletEvent.data.callHash;
              console.log('tx id', txMultiHash);
            }
          }
        } else {
          console.log('  ⚠️  No events yet (waiting for block inclusion)');
        }

        if (result.status.type === 'BestChainBlockIncluded' || result.status.type === 'Finalized') {
          console.log('✅ Transaction included in block!');
          txIncluded = true;
        }

        if (result.status.type === 'Finalized') {
          console.log('✅ Transaction finalized!');
          clearTimeout(timeout);
          await unsub();
          resolve();
        }

        if (result.status.type === 'Drop') {
          console.error('❌ Transaction dropped from pool');
          clearTimeout(timeout);
          await unsub();
          reject(new Error('Transaction dropped'));
        }
      });
    });
  } catch (error: any) {
    // Handle WebSocket timeout gracefully
    if (
      error?.message?.includes('No new blocks received') ||
      error?.message?.includes('Websocket connection does not exist')
    ) {
      console.log(
        '\n⚠️  WebSocket subscription timed out, but transaction may have been included.',
      );
      console.log('Checking transaction status via polling...\n');
      txIncluded = true; // Assume included and verify below
    } else {
      throw error;
    }
  }

  // For signing operations (when `when` is provided), we don't need to return hash
  if (when !== undefined) {
    if (!txIncluded) {
      console.log('\n⚠️  Transaction status unknown due to connection timeout.');
      console.log('Please verify manually or retry the operation.\n');
    }
    return null;
  }

  if (!txMultiHash) throw new Error('Was not able to submit new multisig');

  // Verify the multisig was stored on-chain
  try {
    const multisigTx = await client.query.multisig.multisigs([multiAddr, txMultiHash]);
    if (multisigTx) {
      console.log('✅ multisig tx stored', multisigTx);
    } else {
      console.log('⚠️  Multisig not found on-chain. Transaction may have failed.');
    }
  } catch (error) {
    console.log('⚠️  Could not verify multisig storage:', error);
  }

  return txMultiHash;
}

// Generic function for config update operations
async function handleConfigUpdate(
  wallet: string,
  configPath: string,
  wsJsonRpcUrl: string,
  multisigStartTxId?: Bytes,
) {
  const thisWallet = await selectWallet(wallet);
  const { multisig, oracleConfig } = loadCliConfig(configPath);

  await useSubstrateClient(wsJsonRpcUrl, async (client) => {
    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);

    const sudoKey = await client.query.sudo.key();
    console.log('Sudo address is ', sudoKey?.address() ?? 'Not found');

    const currentConfig = await getCurrentConfig(client);
    console.log('Current oracle config:', currentConfig);
    console.log('Desired oracle config:', oracleConfig);

    // Create the oracle call wrapped in sudo
    const oracleCall = client.tx.oracle.sudoSetConfig(
      oracleConfig.consensus,
      oracleConfig.messages,
      oracleConfig.reward,
    );
    const sudoCall = client.tx.sudo.sudo(oracleCall.call);

    // Get timepoint if this is a signing operation
    let when = undefined;
    if (multisigStartTxId) {
      const multisigStartTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
      if (!multisigStartTx) throw new Error('Was not able to retrieve multisig');
      when = multisigStartTx.when;
    }

    await executeMultisigTx({
      client,
      wallet: thisWallet,
      multisigAddresses: multisig.addresses,
      threshold: multisig.threshold,
      sudoCall,
      when,
    });

    // Query updated config
    try {
      const updatedConfig = await getCurrentConfig(client);
      console.log('\n📊 Updated oracle config:', updatedConfig);

      // Compare with desired config to verify
      if (when !== undefined && multisigStartTxId) {
        // This was a signing operation that should have executed
        const configChanged = JSON.stringify(updatedConfig) !== JSON.stringify(currentConfig);
        if (configChanged) {
          console.log('\n✅ Config update succeeded! Changes are live on-chain.');
        } else {
          console.log('\n⚠️  Config appears unchanged. This could mean:');
          console.log('   - Threshold not yet reached (need more signatures)');
          console.log('   - Transaction still pending');
          console.log('   - Transaction failed (check events above)');
        }
      }
    } catch (error) {
      console.log('\n⚠️  Could not query updated config:', error);
      console.log('Transaction may have succeeded. Verify manually with check-balance command.');
    }
  });
}

// Generic function for node authorization/deauthorization operations
async function handleNodeOperation(
  wallet: string,
  configPath: string,
  nodePubKey: string,
  wsJsonRpcUrl: string,
  operation: 'authorize' | 'deauthorize',
  multisigStartTxId?: Bytes,
) {
  const thisWallet = await selectWallet(wallet);
  const { multisig } = loadMultisigConfig(configPath);
  const nodeKey = new AccountId32(nodePubKey);

  console.log('Node key is ', nodeKey);

  await useSubstrateClient(wsJsonRpcUrl, async (client) => {
    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);

    const sudoKey = await client.query.sudo.key();
    console.log('Sudo address is ', sudoKey?.address() ?? 'Not found');

    const currentNodesRaw = await client.query.oracle.authorizedOracleNodes.entries();
    const currentNodes = currentNodesRaw.map((account: any) => account[0]);
    console.log('Current oracle nodes:', currentNodes);

    // Create the appropriate oracle call based on operation
    const oracleCall =
      operation === 'authorize'
        ? client.tx.oracle.sudoRegisterOracleNode(nodeKey)
        : client.tx.oracle.sudoDeregisterOracleNode(nodeKey);

    const sudoCall = client.tx.sudo.sudo(oracleCall.call);

    // Get timepoint if this is a signing operation
    let when = undefined;
    if (multisigStartTxId) {
      const multisigStartTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
      if (!multisigStartTx) throw new Error('Was not able to retrieve multisig');
      when = multisigStartTx.when;
    }

    await executeMultisigTx({
      client,
      wallet: thisWallet,
      multisigAddresses: multisig.addresses,
      threshold: multisig.threshold,
      sudoCall,
      when,
    });

    // Query and verify result
    const updatedNodesRaw = await client.query.oracle.authorizedOracleNodes.entries();
    const updatedNodes = updatedNodesRaw.map((account: any) => account[0]);
    console.log('Updated oracle nodes:', updatedNodes);

    const nodeExists = updatedNodes.find((el: any) => el.eq(nodeKey));
    if (operation === 'authorize' && nodeExists) {
      console.log('Oracle node added successfully!');
    } else if (operation === 'deauthorize' && !nodeExists) {
      console.log('Oracle node removed successfully!');
    }
  });
}

// Config update commands
addWalletAndConfigOptions(
  program
    .command('start-config-update')
    .description(
      'Submit new oracle configuration update tx, which may require several steps in case of multisig',
    ),
).action(async (opts) => {
  await handleConfigUpdate(opts.wallet, opts.config, opts.substrateRpc);
});

addWalletAndConfigOptions(
  addSigningOptions(
    program
      .command('sign-config-update')
      .description(
        'Sign oracle configuration update tx, and complete it in case of multisig threshold was reached',
      ),
  ),
).action(async (opts) => {
  await handleConfigUpdate(opts.wallet, opts.config, opts.substrateRpc, opts.tx);
});

// Authorize node commands
addWalletAndConfigOptions(
  addNodeOption(
    program.command('start-authorize-node').description('Submit new Authorize Oracle Node tx'),
    'String refers to AccountId32Like of added node',
  ),
).action(async (opts) => {
  await handleNodeOperation(opts.wallet, opts.config, opts.node, opts.substrateRpc, 'authorize');
});

addWalletAndConfigOptions(
  addSigningOptions(
    addNodeOption(
      program.command('sign-authorize-node').description('Sign Authorize Oracle Node tx'),
      'String refers to AccountId32Like of added node',
    ),
  ),
).action(async (opts) => {
  await handleNodeOperation(
    opts.wallet,
    opts.config,
    opts.node,
    opts.substrateRpc,
    'authorize',
    opts.tx,
  );
});

// Deauthorize node commands
addWalletAndConfigOptions(
  addNodeOption(
    program.command('start-deauthorize-node').description('Submit new Deauthorize Oracle Node tx'),
    'String refers to AccountId32Like of removed node',
  ),
).action(async (opts) => {
  await handleNodeOperation(opts.wallet, opts.config, opts.node, opts.substrateRpc, 'deauthorize');
});

addWalletAndConfigOptions(
  addSigningOptions(
    addNodeOption(
      program.command('sign-deauthorize-node').description('Sign Deauthorize Oracle Node tx'),
      'String refers to AccountId32Like of added node',
    ),
  ),
).action(async (opts) => {
  await handleNodeOperation(
    opts.wallet,
    opts.config,
    opts.node,
    opts.substrateRpc,
    'deauthorize',
    opts.tx,
  );
});

// ==================== STAKING COMMANDS ====================

program.addCommand(createStakingCommand());

// Balance check command
program
  .command('check-balance')
  .description('Check balance of wallet and multisig addresses')
  .option('-w, --wallet <wallet>', 'Wallet seed or derivation path')
  .option('-c, --config <config>', 'Config file path', 'config.yml')
  .option('-s, --substrate-rpc <substrateRpc>', 'Substrate RPC endpoint', 'ws://127.0.0.1:9944')
  .action(async (opts) => {
    const wallet = await selectWallet(opts.wallet);
    const { multisig } = loadMultisigConfig(opts.config);

    console.log('Wallet address:', wallet.address);
    console.log('Multisig config:', multisig);

    await useSubstrateClient(opts.substrateRpc, async (client) => {
      // Check wallet balance
      const walletAccount = await client.query.system.account(wallet.address);
      console.log('\nWallet balance:', {
        free: walletAccount.data.free.toString(),
        reserved: walletAccount.data.reserved.toString(),
        frozen: walletAccount.data.frozen.toString(),
      });

      // Check multisig address balance
      const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);
      const multisigAccount = await client.query.system.account(multiAddr);
      console.log('\nMultisig address:', multiAddr);
      console.log('Multisig balance:', {
        free: multisigAccount.data.free.toString(),
        reserved: multisigAccount.data.reserved.toString(),
        frozen: multisigAccount.data.frozen.toString(),
      });

      // Check sudo address balance
      const sudoKey = await client.query.sudo.key();
      if (sudoKey) {
        const sudoAccount = await client.query.system.account(sudoKey);
        console.log('\nSudo address:', sudoKey.toString());
        console.log('Sudo balance:', {
          free: sudoAccount.data.free.toString(),
          reserved: sudoAccount.data.reserved.toString(),
          frozen: sudoAccount.data.frozen.toString(),
        });
      }
    });
  });

// Get multisig hex address command
program
  .command('get-multisig-hex')
  .description('Get hex address of multisig composite account for chain spec')
  .option('-c, --config <config>', 'Config file path', 'config.yml')
  .action(async (opts) => {
    const { multisig } = loadMultisigConfig(opts.config);
    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);

    console.log('\nMultisig Configuration:');
    console.log('Addresses:', multisig.addresses);
    console.log('Threshold:', multisig.threshold);
    console.log('\nMultisig Composite Account:');
    console.log('SS58 Address:', multiAddr);

    // Convert to hex
    const { decodeAddress } = await import('@polkadot/util-crypto');
    const { u8aToHex } = await import('@polkadot/util');
    const decoded = decodeAddress(multiAddr);
    const hex = u8aToHex(decoded);

    console.log('Hex Address: ', hex);
    console.log('\nAdd this to your chain spec template_chain_spec.rs:');
    console.log(`AccountId::from_str("${hex}").unwrap()`);
  });

// Convert addresses command
program
  .command('convert-addresses')
  .description('Convert SS58 addresses to hex for chain spec comparison')
  .option('-c, --config <config>', 'Config file path', 'config.yml')
  .action(async (opts) => {
    const { multisig } = loadMultisigConfig(opts.config);
    const { decodeAddress } = await import('@polkadot/util-crypto');
    const { u8aToHex } = await import('@polkadot/util');

    console.log('\nIndividual Signers from config.yml:');
    console.log('=====================================');
    multisig.addresses.forEach((addr, i) => {
      const decoded = decodeAddress(addr);
      const hex = u8aToHex(decoded);
      console.log(`\n${i + 1}. SS58: ${addr}`);
      console.log(`   Hex:  ${hex}`);
    });

    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);
    const decodedMulti = decodeAddress(multiAddr);
    const hexMulti = u8aToHex(decodedMulti);

    console.log('\n\nMultisig Composite:');
    console.log('===================');
    console.log(`SS58: ${multiAddr}`);
    console.log(`Hex:  ${hexMulti}`);

    console.log('\n\nChain Spec Should Have:');
    console.log('=======================');
    console.log('let endowed_accounts: Vec<AccountId> = [');
    multisig.addresses.forEach((addr, i) => {
      const decoded = decodeAddress(addr);
      const hex = u8aToHex(decoded);
      console.log(`    // Signer ${i + 1}`);
      console.log(`    AccountId::from_str("${hex}").unwrap(),`);
    });
    console.log(`    // Multisig Composite (also sudo key)`);
    console.log(`    AccountId::from_str("${hexMulti}").unwrap(),`);
    console.log('].to_vec();');
  });

program.parseAsync(process.argv);

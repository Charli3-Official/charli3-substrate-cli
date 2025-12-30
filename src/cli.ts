import { Command } from 'commander';
import { sortAddresses } from '@polkadot/util-crypto';
import { getCurrentConfig, useSubstrateClient } from './service/query.js';
import { createMultiAddress, loadTestnetWallet, loadWallet } from './service/crypto.js';
import { txCallback, waitForTx } from './service/tx.js';
import { loadCliConfig, loadMultisigConfig } from './service/config.js';
import { AccountId32, type Bytes } from 'dedot/codecs';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { DedotClient } from 'dedot';
import type {
  Charli3SubstrateRuntimeApi,
  PalletMultisigTimepoint,
} from './charli3-substrate-runtime/index.js';
import type { TxPaymentInfo } from 'dedot/types';
import type { ChainSubmittableExtrinsic } from './charli3-substrate-runtime/tx.js';

const program = new Command();

program.name('charli3').description('Oracle platform CLI').version('1.0.0');

// Helper function to select wallet
async function selectWallet(suriOrName: string): Promise<KeyringPair> {
  if (suriOrName.split(' ').length >= 12) {
    return await loadWallet(suriOrName);
  }
  return await loadTestnetWallet(suriOrName);
}

// Helper to calculate safe weight with 2x buffer
function calculateSafeWeight(estimation: TxPaymentInfo) {
  return {
    refTime: estimation.weight.refTime * 2n,
    proofSize: estimation.weight.proofSize * 2n,
  };
}

// Generic multisig transaction executor
interface MultisigTxParams {
  client: DedotClient<Charli3SubstrateRuntimeApi>;
  wallet: KeyringPair;
  multisigAddresses: string[];
  threshold: number;
  sudoCall: ChainSubmittableExtrinsic<any>;
  when?: PalletMultisigTimepoint | undefined;
}

async function executeMultisigTx({
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

  const unsub = await txFinal.signAndSend(wallet, { tip: 0n }, async (result) => {
    txCallback(result);
    for (const e of result.events) {
      if (e.event.pallet === 'Multisig' && e.event.palletEvent.name === 'NewMultisig') {
        console.log(e.event.palletEvent.data);
        txMultiHash = e.event.palletEvent.data.callHash;
        console.log('tx id', txMultiHash);
      }
    }
    if (result.status.type === 'Finalized') await unsub();
  });

  await waitForTx(client);

  // For signing operations (when `when` is provided), we don't need to return hash
  if (when !== undefined) {
    return null;
  }

  if (!txMultiHash) throw new Error('Was not able to submit new multisig');

  const multisigTx = await client.query.multisig.multisigs([multiAddr, txMultiHash]);
  console.log('multisig tx stored', multisigTx);

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
    const updatedConfig = await getCurrentConfig(client);
    console.log('Updated oracle config:', updatedConfig);
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
    const currentNodes = currentNodesRaw.map((account) => account[0]);
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
    const updatedNodes = updatedNodesRaw.map((account) => account[0]);
    console.log('Updated oracle nodes:', updatedNodes);

    const nodeExists = updatedNodes.find((el) => el.eq(nodeKey));
    if (operation === 'authorize' && nodeExists) {
      console.log('Oracle node added successfully!');
    } else if (operation === 'deauthorize' && !nodeExists) {
      console.log('Oracle node removed successfully!');
    }
  });
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

program.parseAsync(process.argv);

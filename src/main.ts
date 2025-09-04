import { DedotClient, WsProvider } from 'dedot';
import { u8aToHex } from '@polkadot/util';
import { createKeyMulti, encodeAddress, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import type {
  Charli3SubstrateRuntimeApi,
  PalletOracleOracleConfiguration,
} from './charli3-substrate-runtime/index.js';

async function main(): Promise<void> {
  await useSubstrateClient(async (client) => {
    // Load an Ed25519 keypair
    await cryptoWaitReady();
    const keyring = new Keyring({ type: 'ed25519' });
    const alice = keyring.addFromUri(
      'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Alice',
    );
    console.log('Alice pk', u8aToHex(alice.publicKey));
    const bob = keyring.addFromUri(
      'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Bob',
    );
    console.log('Bob pk', u8aToHex(bob.publicKey));
    const charlie = keyring.addFromUri(
      'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Charlie',
    );
    console.log('Charlie pk', u8aToHex(charlie.publicKey));

    const signers = [alice.address, bob.address, charlie.address];
    const threshold = 2;
    const multiPub = createKeyMulti(signers, threshold);
    const multiAddr = encodeAddress(multiPub, 42);
    console.log('Multisig address', multiAddr);

    const sudoKey = await client.query.sudo.key();
    console.log('Sudo address is ', sudoKey?.address() ?? 'Not found');

    let oracleConfig = await getCurrentConfig(client);
    console.log('Oracle config:', oracleConfig);
    oracleConfig.minNodesForTrustedAggregation = 3;
    oracleConfig.feedAge = 12;
    oracleConfig.outliersRange = 160;
    oracleConfig.divergency = 65;

    // Sign + send
    const oracleCall = client.tx.oracle.sudoSetConfig(oracleConfig);

    // Wrap it in sudo.sudo
    const sudoCall = client.tx.sudo.sudo(oracleCall.call);

    // Wrap it in multisig
    const txMulti = client.tx.multisig.asMulti(
      2,
      [bob.address, charlie.address],
      undefined,
      sudoCall.call,
      {
        refTime: 0n,
        proofSize: 0n,
      },
    );
    const txEstimation = await txMulti.paymentInfo(alice, { tip: 0n });
    console.log('tx estimation', txEstimation);
    const txAlice = client.tx.multisig.asMulti(
      2,
      [bob.address, charlie.address],
      undefined,
      sudoCall.call,
      txEstimation.weight,
    );

    const unsub = await txAlice.signAndSend(
      alice,
      { tip: 0n },
      async ({ status, dispatchError }) => {
        console.log('Transaction status', status.type);
        if (dispatchError) {
          console.log('Dispatch error:', dispatchError.type);
          if (dispatchError.type === 'Module') {
            console.log('Dispatch module:', dispatchError.value);
          }
        }
        if (status.type === 'BestChainBlockIncluded') {
          console.log(`Transaction is included in best block`);
        }
        if (status.type === 'Finalized') {
          console.log(`Transaction finalized at block hash ${status.value.blockHash}`);
          await unsub();
        }
      },
    );

    // Query config
    const waitTime = Number(client.consts.aura.slotDuration) + 1_000;
    console.log(`Waiting for ${waitTime} milliseconds (block production time + 1 sec)...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    oracleConfig = await getCurrentConfig(client);
    console.log('Oracle config:', oracleConfig);
  });
}

main().catch(console.error);

async function getCurrentConfig(
  client: DedotClient<Charli3SubstrateRuntimeApi>,
): Promise<PalletOracleOracleConfiguration> {
  const minNodesForTrustedAggregation = await client.query.oracle.minNodesForTrustedAggregation();
  const feedAge = await client.query.oracle.feedAge();
  const outliersRange = await client.query.oracle.outliersRange();
  const divergency = await client.query.oracle.divergency();
  const tradePairs = await client.query.oracle.tradePairs();
  if (
    minNodesForTrustedAggregation === undefined ||
    feedAge === undefined ||
    outliersRange === undefined ||
    divergency === undefined ||
    tradePairs === undefined
  ) {
    throw new Error("Couldn't load oracle config");
  }

  return {
    minNodesForTrustedAggregation,
    feedAge,
    outliersRange,
    divergency,
    tradePairs,
  };
}

async function useSubstrateClient(
  action: (client: DedotClient<Charli3SubstrateRuntimeApi>) => Promise<void>,
) {
  let provider;
  try {
    // Connect
    provider = new WsProvider('ws://127.0.0.1:9944');
    const client = await DedotClient.new<Charli3SubstrateRuntimeApi>(provider);
    // Use
    await action(client);
  } finally {
    // Disconnect
    if (provider) await provider.disconnect();
  }
}

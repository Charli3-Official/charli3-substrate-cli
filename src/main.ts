import { sortAddresses } from '@polkadot/util-crypto';
import { getCurrentConfig, useSubstrateClient } from './service/query.js';
import { createMultiAddress, loadTestnetWallets } from './service/crypto.js';
import { txCallback, waitForTx } from './service/tx.js';

async function main(): Promise<void> {
  await useSubstrateClient(async (client) => {
    const { alice, bob, charlie } = await loadTestnetWallets();
    const multiAddr = createMultiAddress([alice.address, bob.address, charlie.address], 2);

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
    const exceptAlice = sortAddresses([bob.address, charlie.address], 42);
    const txMulti = client.tx.multisig.asMulti(2, exceptAlice, undefined, sudoCall.call, {
      refTime: 0n,
      proofSize: 0n,
    });
    const txEstimation = await txMulti.paymentInfo(alice, { tip: 0n });
    console.log('tx estimation', txEstimation);
    const txAlice = client.tx.multisig.asMulti(
      2,
      exceptAlice,
      undefined,
      sudoCall.call,
      txEstimation.weight,
    );
    let txMultiHash: `0x${string}` | undefined = undefined;
    const unsubAlice = await txAlice.signAndSend(alice, { tip: 0n }, async (result) => {
      txCallback(result);
      for (const e of result.events) {
        if (e.event.pallet === 'Multisig') {
          console.log(e.event.palletEvent.data);
          if (e.event.palletEvent.name === 'NewMultisig') {
            txMultiHash = e.event.palletEvent.data.callHash;
            console.log('tx id', txMultiHash);
          }
        }
      }
      if (result.status.type === 'Finalized') await unsubAlice();
    });
    await waitForTx(client);
    if (!txMultiHash) {
      throw new Error('Was not able to submit new multisig');
    }
    const multisig = await client.query.multisig.multisigs([multiAddr, txMultiHash]);
    console.log('multisig tx stored', multisig);
    if (!multisig) {
      throw new Error('Was not able to retrieve multisig');
    }

    const txBob = client.tx.multisig.asMulti(
      2,
      sortAddresses([alice.address, charlie.address], 42),
      multisig.when,
      sudoCall.call,
      txEstimation.weight,
    );
    const unsubBob = await txBob.signAndSend(bob, { tip: 0n }, async (result) => {
      txCallback(result);
      if (result.status.type === 'Finalized') await unsubBob();
    });
    await waitForTx(client);

    // Query config
    oracleConfig = await getCurrentConfig(client);
    console.log('Oracle config:', oracleConfig);
  });
}

main().catch(console.error);

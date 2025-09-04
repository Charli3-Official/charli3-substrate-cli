import { sortAddresses } from '@polkadot/util-crypto';

import { getCurrentConfig, useSubstrateClient } from './query.js';
import { createMultiAddress, loadTestnetWallets } from './crypto.js';

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
    const unsubAlice = await txAlice.signAndSend(
      alice,
      { tip: 0n },
      async ({ status, dispatchError, events }) => {
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
        for (const e of events) {
          console.log(e);
          if (e.event.pallet === 'Multisig') {
            console.log(e.event.palletEvent.data);
            if (e.event.palletEvent.name === 'NewMultisig') {
              txMultiHash = e.event.palletEvent.data.callHash;
              console.log('tx id', txMultiHash);
            }
          }
        }
        if (status.type === 'Finalized') {
          console.log(`Transaction finalized at block hash ${status.value.blockHash}`);
          await unsubAlice();
        }
      },
    );
    const waitTime = Number(client.consts.aura.slotDuration) + 1_000;
    console.log(`Waiting for ${waitTime} milliseconds (block production time + 1 sec)...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
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
    const unsubBob = await txBob.signAndSend(
      bob,
      { tip: 0n },
      async ({ status, dispatchError, events }) => {
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
        for (const e of events) {
          console.log(e);
          if (e.event.pallet === 'Multisig') {
            console.log(e.event.palletEvent.data);
          }
        }
        if (status.type === 'Finalized') {
          console.log(`Transaction finalized at block hash ${status.value.blockHash}`);
          await unsubBob();
        }
      },
    );
    console.log(`Waiting for ${waitTime} milliseconds (block production time + 1 sec)...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Query config
    oracleConfig = await getCurrentConfig(client);
    console.log('Oracle config:', oracleConfig);
  });
}

main().catch(console.error);

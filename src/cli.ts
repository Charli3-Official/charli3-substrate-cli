import { Command } from 'commander';
import { sortAddresses } from '@polkadot/util-crypto';
import { getCurrentConfig, useSubstrateClient } from './service/query.js';
import { createMultiAddress, loadTestnetWallet, loadWallet } from './service/crypto.js';
import { txCallback, waitForTx } from './service/tx.js';
import { loadCliConfig } from './service/config.js';
import type { Bytes } from 'dedot/codecs';
import type { KeyringPair } from '@polkadot/keyring/types';

const program = new Command();

program.name('charli3').description('Oracle platform CLI').version('1.0.0');

async function startConfigUpdate(wallet: string, configPath: string) {
  // Select wallet
  const thisWallet = await selectWallet(wallet);

  // Load multisig and oracle config from YAML
  const { multisig, oracleConfig } = loadCliConfig(configPath);

  await useSubstrateClient(async (client) => {
    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);

    const sudoKey = await client.query.sudo.key();
    console.log('Sudo address is ', sudoKey?.address() ?? 'Not found');

    const currentConfig = await getCurrentConfig(client);
    console.log('Current oracle config:', currentConfig);
    console.log('Desired oracle config:', oracleConfig);

    // Create update config tx
    const oracleCall = client.tx.oracle.sudoSetConfig(
      oracleConfig.consensus,
      oracleConfig.messages,
    );
    // Wrap it in sudo.sudo
    const sudoCall = client.tx.sudo.sudo(oracleCall.call);

    // Wrap it in multisig
    const otherSignatories = sortAddresses(
      multisig.addresses.filter((value) => value !== thisWallet.address),
      42,
    );
    const txMulti = client.tx.multisig.asMulti(
      multisig.threshold,
      otherSignatories,
      undefined,
      sudoCall.call,
      {
        refTime: 0n,
        proofSize: 0n,
      },
    );
    const txEstimation = await txMulti.paymentInfo(thisWallet, { tip: 0n });
    console.log('tx estimation', txEstimation);
    const safeWeight = {
      refTime: txEstimation.weight.refTime * 2n,
      proofSize: txEstimation.weight.proofSize * 2n,
    };
    const txFinal = client.tx.multisig.asMulti(
      multisig.threshold,
      otherSignatories,
      undefined,
      sudoCall.call,
      safeWeight,
    );
    let txMultiHash: `0x${string}` | undefined = undefined;
    const unsub = await txFinal.signAndSend(thisWallet, { tip: 0n }, async (result) => {
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
    if (!txMultiHash) throw new Error('Was not able to submit new multisig');
    const multisigTx = await client.query.multisig.multisigs([multiAddr, txMultiHash]);
    console.log('multisig tx stored', multisigTx);
  });
}

async function signConfigUpdate(wallet: string, multisigStartTxId: Bytes, configPath: string) {
  // Select wallet
  const thisWallet = await selectWallet(wallet);

  // Load multisig and oracle config from YAML
  const { multisig, oracleConfig } = loadCliConfig(configPath);

  await useSubstrateClient(async (client) => {
    const multiAddr = createMultiAddress(multisig.addresses, multisig.threshold);

    const sudoKey = await client.query.sudo.key();
    console.log('Sudo address is ', sudoKey?.address() ?? 'Not found');

    const currentConfig = await getCurrentConfig(client);
    console.log('Current oracle config:', currentConfig);
    console.log('Desired oracle config:', oracleConfig);

    // Create update config tx
    const oracleCall = client.tx.oracle.sudoSetConfig(
      oracleConfig.consensus,
      oracleConfig.messages,
    );
    // Wrap it in sudo.sudo
    const sudoCall = client.tx.sudo.sudo(oracleCall.call);

    const multisigStartTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
    if (!multisigStartTx) throw new Error('Was not able to retrieve multisig');

    // Wrap it in multisig
    const otherSignatories = sortAddresses(
      multisig.addresses.filter((value) => value !== thisWallet.address),
      42,
    );
    const txMulti = client.tx.multisig.asMulti(
      multisig.threshold,
      otherSignatories,
      multisigStartTx.when,
      sudoCall.call,
      {
        refTime: 0n,
        proofSize: 0n,
      },
    );
    const txEstimation = await txMulti.paymentInfo(thisWallet, { tip: 0n });
    console.log('tx estimation', txEstimation);
    const safeWeight = {
      refTime: txEstimation.weight.refTime * 2n,
      proofSize: txEstimation.weight.proofSize * 2n,
    };
    const txFinal = client.tx.multisig.asMulti(
      multisig.threshold,
      otherSignatories,
      multisigStartTx.when,
      sudoCall.call,
      safeWeight,
    );
    const unsub = await txFinal.signAndSend(thisWallet, { tip: 0n }, async (result) => {
      txCallback(result);
      if (result.status.type === 'Finalized') await unsub();
    });
    await waitForTx(client);

    // Query config
    const updatedConfig = await getCurrentConfig(client);
    console.log('Updated oracle config:', updatedConfig);
  });
}

async function selectWallet(suriOrName: string): Promise<KeyringPair> {
  if (suriOrName.split(' ').length >= 12) {
    // If argument is a SURI, then load wallet dynamically
    const wallet = await loadWallet(suriOrName);
    return wallet;
  } else {
    // Otherwise, treat it as a testnet wallet name
    const testWallet = await loadTestnetWallet(suriOrName);
    return testWallet;
  }
}

program
  .command('start-config-update')
  .description(
    'Submit new oracle configuration update tx, which may require several steps in case of multisig',
  )
  .requiredOption(
    '-w, --wallet <string>',
    'String refers to wallet test name, e.g. Alice, or the suri itself',
  )
  .option(
    '-c, --config <path>',
    'YAML file for Multisig and Oracle configurations',
    'testnet-config.yml',
  )
  .action(async (opts) => {
    await startConfigUpdate(opts.wallet, opts.config);
  });

program
  .command('sign-config-update')
  .description(
    'Sign oracle configuration update tx, and complete it in case of multisig threshold was reached',
  )
  .requiredOption(
    '-w, --wallet <string>',
    'String refers to wallet test name, e.g. Alice, or the suri itself',
  )
  .requiredOption('-x, --tx <id>', 'Original multisig start tx hash as an 0x-string')
  .option(
    '-c, --config <path>',
    'YAML file for Multisig and Oracle configurations',
    'testnet-config.yml',
  )
  .action(async (opts) => {
    await signConfigUpdate(opts.wallet, opts.tx, opts.config);
  });

program.parseAsync(process.argv);

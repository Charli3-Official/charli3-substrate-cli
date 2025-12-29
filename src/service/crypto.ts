import { BN, u8aToHex } from '@polkadot/util';
import { createKeyMulti, encodeAddress, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';

export { loadTestnetWallet, createMultiAddress, loadWallet };

async function loadWallet(suri: string): Promise<KeyringPair> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'ed25519' });
  const wallet = keyring.addFromUri(suri);
  console.log('This Wallet pk  ', u8aToHex(wallet.publicKey));
  console.log('This Wallet addr', wallet.address);
  return wallet;
}

async function loadTestnetWallet(testWalletName: string): Promise<KeyringPair> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'ed25519' });
  const testWallet = keyring.addFromUri(
    `bottom drive obey lake curtain smoke basket hold race lonely fit walk//${testWalletName}`,
  );
  console.log('Test Wallet pk    ', u8aToHex(testWallet.publicKey));
  console.log('Test Wallet addr  ', testWallet.address);

  return testWallet;
}

function createMultiAddress(
  signers: (string | Uint8Array<ArrayBufferLike>)[],
  threshold: bigint | BN | number,
): string {
  const multiPub = createKeyMulti(signers, threshold);
  const multiAddr = encodeAddress(multiPub, 42);
  console.log('Multisig address', multiAddr);
  return multiAddr;
}

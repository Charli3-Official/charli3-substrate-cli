import { BN, u8aToHex } from '@polkadot/util';
import { createKeyMulti, encodeAddress, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';

export type { TestnetWallets, WalletName };
export { loadTestnetWallets, createMultiAddress, loadWallet };

async function loadWallet(suri: string): Promise<KeyringPair> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'ed25519' });
  const wallet = keyring.addFromUri(suri);
  console.log('This Wallet pk  ', u8aToHex(wallet.publicKey));
  console.log('This Wallet addr', wallet.address);
  return wallet;
}

interface TestnetWallets {
  readonly one: KeyringPair;
  readonly two: KeyringPair;
  readonly three: KeyringPair;
  readonly four: KeyringPair;
  readonly five: KeyringPair;
}

type WalletName = keyof TestnetWallets;

async function loadTestnetWallets(): Promise<TestnetWallets> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'ed25519' });
  const one = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//AdminOne',
  );
  console.log('AdminOne pk    ', u8aToHex(one.publicKey));
  console.log('AdminOne addr  ', one.address);
  const two = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//AdminTwo',
  );
  console.log('AdminTwo pk    ', u8aToHex(two.publicKey));
  console.log('AdminTwo addr  ', two.address);
  const three = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//AdminThree',
  );
  console.log('AdminThree pk  ', u8aToHex(three.publicKey));
  console.log('AdminThree addr', three.address);
  const four = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//AdminFour',
  );
  console.log('AdminFour pk   ', u8aToHex(four.publicKey));
  console.log('AdminFour addr ', four.address);
  const five = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//AdminFive',
  );
  console.log('AdminFive pk   ', u8aToHex(five.publicKey));
  console.log('AdminFive addr ', five.address);

  return {
    one,
    two,
    three,
    four,
    five,
  };
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

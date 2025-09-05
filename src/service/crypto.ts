import { BN, u8aToHex } from '@polkadot/util';
import { createKeyMulti, encodeAddress, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';

export type { TestnetWallets, WalletName };
export { loadTestnetWallets, createMultiAddress };

interface TestnetWallets {
  readonly alice: KeyringPair;
  readonly bob: KeyringPair;
  readonly charlie: KeyringPair;
  readonly dave: KeyringPair;
  readonly eve: KeyringPair;
}

type WalletName = keyof TestnetWallets;

async function loadTestnetWallets(): Promise<TestnetWallets> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'ed25519' });
  const alice = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Alice',
  );
  console.log('Alice pk  ', u8aToHex(alice.publicKey));
  const bob = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Bob',
  );
  console.log('Bob pk    ', u8aToHex(bob.publicKey));
  const charlie = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Charlie',
  );
  console.log('Charlie pk', u8aToHex(charlie.publicKey));
  const dave = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Dave',
  );
  console.log('Dave pk', u8aToHex(dave.publicKey));
  const eve = keyring.addFromUri(
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Eve',
  );
  console.log('Eve pk', u8aToHex(eve.publicKey));

  return {
    alice,
    bob,
    charlie,
    dave,
    eve,
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

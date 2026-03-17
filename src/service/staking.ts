import type { DedotClient } from 'dedot';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { CardanoSidechainApi } from '../charli3-substrate-runtime/index.js';
import type { Charli3OracleCorePalletSlashVote } from '../charli3-substrate-runtime/types.js';
import { AccountId32, type Bytes } from 'dedot/codecs';
import { txCallback, waitForTx } from './tx.js';
import { createMultiAddress } from './crypto.js';
import type { PalletMultisigTimepoint } from '../charli3-substrate-runtime/index.js';
import { executeMultisigTx } from '../cli.js';

// ==================== DIRECT EXTRINSICS (single sig, signed by node) ====================

export async function handleConfirmCardanoStake(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  txHash: string,
): Promise<void> {
  const hash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  const extrinsic = client.tx.oracle.confirmCardanoStake(hash as `0x${string}`);
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

export async function handleRequestRetire(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
): Promise<void> {
  const extrinsic = client.tx.oracle.requestRetire();
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

export async function handleRequestSlash(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  nodeAccount: string,
  slashAmount: bigint,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);
  const extrinsic = client.tx.oracle.requestSlash(nodeKey, slashAmount);
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

export async function handleVoteSlash(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  nodeAccount: string,
  vote: Charli3OracleCorePalletSlashVote,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);
  const extrinsic = client.tx.oracle.voteSlash(nodeKey, vote);
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

export async function handleConfirmCardanoWithdrawal(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  txHash: string,
  releasedAmount: bigint,
  penaltyAmount: bigint,
): Promise<void> {
  const hash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  const extrinsic = client.tx.oracle.confirmCardanoWithdrawal(
    hash as `0x${string}`,
    releasedAmount,
    penaltyAmount,
  );
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

// ==================== SUDO MULTISIG EXTRINSICS (signed by admins) ====================

export async function handleGenerateStakingCertificate(
  client: DedotClient<CardanoSidechainApi>,
  multisigAddresses: string[],
  threshold: number,
  wallet: KeyringPair,
  nodeAccount: string,
  amount: bigint,
  lockUntilBlock: number,
  expiresAtBlock: number,
  multisigStartTxId?: Bytes,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);
  const multiAddr = createMultiAddress(multisigAddresses, threshold);

  const oracleCall = client.tx.oracle.generateStakingCertificate(
    nodeKey,
    amount,
    lockUntilBlock,
    expiresAtBlock,
  );
  const sudoCall = client.tx.sudo.sudo(oracleCall.call);

  let when: PalletMultisigTimepoint | undefined;
  if (multisigStartTxId) {
    const multisigTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
    if (!multisigTx) throw new Error('Multisig transaction not found');
    when = multisigTx.when;
  }

  await executeMultisigTx({ client, wallet, multisigAddresses, threshold, sudoCall, when });
}

export async function handleGenerateRetireCertificate(
  client: DedotClient<CardanoSidechainApi>,
  multisigAddresses: string[],
  threshold: number,
  wallet: KeyringPair,
  nodeAccount: string,
  lockUntilBlock: number,
  multisigStartTxId?: Bytes,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);
  const multiAddr = createMultiAddress(multisigAddresses, threshold);

  // expiresAtBlock is unused in the pallet (prefixed _), pass 0
  const oracleCall = client.tx.oracle.generateRetireCertificate(nodeKey, lockUntilBlock, 0);
  const sudoCall = client.tx.sudo.sudo(oracleCall.call);

  let when: PalletMultisigTimepoint | undefined;
  if (multisigStartTxId) {
    const multisigTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
    if (!multisigTx) throw new Error('Multisig transaction not found');
    when = multisigTx.when;
  }

  await executeMultisigTx({ client, wallet, multisigAddresses, threshold, sudoCall, when });
}

export async function handleGenerateWithdrawalCertificate(
  client: DedotClient<CardanoSidechainApi>,
  multisigAddresses: string[],
  threshold: number,
  wallet: KeyringPair,
  nodeAccount: string,
  approvedAmount: bigint,
  multisigStartTxId?: Bytes,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);
  const multiAddr = createMultiAddress(multisigAddresses, threshold);

  // expiresAtBlock is unused in the pallet (prefixed _), pass 0
  const oracleCall = client.tx.oracle.generateWithdrawalCertificate(nodeKey, approvedAmount, 0);
  const sudoCall = client.tx.sudo.sudo(oracleCall.call);

  let when: PalletMultisigTimepoint | undefined;
  if (multisigStartTxId) {
    const multisigTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
    if (!multisigTx) throw new Error('Multisig transaction not found');
    when = multisigTx.when;
  }

  await executeMultisigTx({ client, wallet, multisigAddresses, threshold, sudoCall, when });
}

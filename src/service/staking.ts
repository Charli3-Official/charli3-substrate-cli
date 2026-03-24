import { AccountId32, type FixedBytes } from 'dedot/codecs';
import { blake2AsU8a } from '@polkadot/util-crypto';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { txCallback, waitForTx } from './tx.js';
import type { DedotClient } from 'dedot';
import type { CardanoSidechainApi } from '../charli3-substrate-runtime/index.js';
import type { KeyringPair } from '@polkadot/keyring/types';

// ==================== CBOR ENCODING UTILITIES ====================
// Must match Rust pallet exactly.
// StakingMessage:    tag(121) + begin_indefinite_array + bytes(cardano_pkh) + uint(stake_amount) + uint(lock_until) + end
// WithdrawalMessage: tag(121) + begin_indefinite_array + bytes(cardano_pkh) + uint(approved_amount) + end

/**
 * Encode a CBOR unsigned integer (major type 0).
 * Handles both number and bigint values.
 */
function encodeCborUint(value: number | bigint): Uint8Array {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n <= 0x17n) {
    return new Uint8Array([Number(n)]);
  } else if (n <= 0xffn) {
    return new Uint8Array([0x18, Number(n)]);
  } else if (n <= 0xffffn) {
    const buf = new Uint8Array(3);
    buf[0] = 0x19;
    buf[1] = Number((n >> 8n) & 0xffn);
    buf[2] = Number(n & 0xffn);
    return buf;
  } else if (n <= 0xffffffffn) {
    const buf = new Uint8Array(5);
    buf[0] = 0x1a;
    buf[1] = Number((n >> 24n) & 0xffn);
    buf[2] = Number((n >> 16n) & 0xffn);
    buf[3] = Number((n >> 8n) & 0xffn);
    buf[4] = Number(n & 0xffn);
    return buf;
  } else {
    const buf = new Uint8Array(9);
    buf[0] = 0x1b;
    buf[1] = Number((n >> 56n) & 0xffn);
    buf[2] = Number((n >> 48n) & 0xffn);
    buf[3] = Number((n >> 40n) & 0xffn);
    buf[4] = Number((n >> 32n) & 0xffn);
    buf[5] = Number((n >> 24n) & 0xffn);
    buf[6] = Number((n >> 16n) & 0xffn);
    buf[7] = Number((n >> 8n) & 0xffn);
    buf[8] = Number(n & 0xffn);
    return buf;
  }
}

/**
 * Encode a CBOR byte string (major type 2).
 */
function encodeCborBytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  let header: Uint8Array;
  if (len <= 0x17) {
    header = new Uint8Array([0x40 | len]);
  } else if (len <= 0xff) {
    header = new Uint8Array([0x58, len]);
  } else {
    header = new Uint8Array([0x59, (len >> 8) & 0xff, len & 0xff]);
  }
  const result = new Uint8Array(header.length + len);
  result.set(header, 0);
  result.set(bytes, header.length);
  return result;
}

/**
 * Concatenate multiple Uint8Array chunks.
 */
function concat(...chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Encode StakingMessage to Cardano CBOR.
 * tag(121) + begin_indefinite_array + bytes(cardano_pkh) + uint(stake_amount) + uint(lock_until) + end
 */
export function encodeStakingMessage(
  cardanoPkhAdminBytes: Uint8Array,
  cardanoPkhAggregationBytes: Uint8Array,
  stakeAmount: bigint,
  lockUntil: number,
): Uint8Array {
  // tag(121) = 0xd8 0x79
  const tag = new Uint8Array([0xd8, 0x79]);
  // begin_indefinite_array = 0x9f
  const beginArray = new Uint8Array([0x9f]);
  // end = 0xff
  const end = new Uint8Array([0xff]);

  return concat(
    tag,
    beginArray,
    encodeCborBytes(cardanoPkhAdminBytes),
    encodeCborBytes(cardanoPkhAggregationBytes),
    encodeCborUint(stakeAmount),
    encodeCborUint(lockUntil),
    end,
  );
}

/**
 * Encode WithdrawalMessage to Cardano CBOR.
 * tag(121) + begin_indefinite_array + bytes(cardano_pkh) + uint(approved_amount) + end
 */
export function encodeWithdrawalMessage(
  cardanoPkhBytes: Uint8Array,
  approvedAmount: bigint,
): Uint8Array {
  const tag = new Uint8Array([0xd8, 0x79]);
  const beginArray = new Uint8Array([0x9f]);
  const end = new Uint8Array([0xff]);

  return concat(
    tag,
    beginArray,
    encodeCborBytes(cardanoPkhBytes),
    encodeCborUint(approvedAmount),
    end,
  );
}

/**
 * Hash CBOR bytes with blake2b-256 (32 bytes output).
 */
export function hashCbor(cbor: Uint8Array): Uint8Array {
  return blake2AsU8a(cbor, 256);
}

/**
 * Sign a message hash with the wallet's ed25519 key.
 * wallet.sign() returns a 65-byte Uint8Array with a 1-byte prefix — strip it.
 * Returns (pubkey_32, sig_64).
 */
export function signWithAdminKey(
  wallet: KeyringPair,
  messageHash: Uint8Array,
): {
  pubkey: Uint8Array;
  sig: Uint8Array;
} {
  const sigWithPrefix = wallet.sign(messageHash);
  // Strip the 1-byte prefix (0x01 for ed25519)
  const sig = sigWithPrefix.length === 65 ? sigWithPrefix.slice(1) : sigWithPrefix;
  return {
    pubkey: wallet.publicKey,
    sig,
  };
}

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

export function encodeSlashVoteMessage(
  cardanoPkhAdminBytes: Uint8Array,
  vote: 'Approve' | 'Deny',
): Uint8Array {
  // tag(121) + begin_indefinite_array + bytes(cardano_pkh_admin) + uint(vote) + end
  const tag = new Uint8Array([0xd8, 0x79]);
  const beginArray = new Uint8Array([0x9f]);
  const end = new Uint8Array([0xff]);
  const voteIndex = vote === 'Approve' ? 0 : 1;
  return concat(
    tag,
    beginArray,
    encodeCborBytes(cardanoPkhAdminBytes),
    encodeCborUint(voteIndex),
    end,
  );
}

export async function handleVoteSlash(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  nodeAccount: string,
  vote: 'Approve' | 'Deny',
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);

  // Look up target node's cardano PKH from chain to build the SlashVoteMessage
  const nodeInfo = await client.query.oracle.authorizedOracleNodes(nodeKey);
  if (!nodeInfo) throw new Error(`Node ${nodeAccount} not found in AuthorizedOracleNodes`);
  const rawPkh = nodeInfo.cardanoPkhAdmin as unknown as any;
  const pkhAdminBytes =
    typeof rawPkh === 'string'
      ? hexToU8a(rawPkh.startsWith('0x') ? rawPkh : `0x${rawPkh}`)
      : rawPkh?.raw
        ? new Uint8Array(rawPkh.raw)
        : new Uint8Array(rawPkh);

  const cbor = encodeSlashVoteMessage(pkhAdminBytes, vote);
  const messageHash = hashCbor(cbor);
  const { pubkey, sig } = signWithAdminKey(wallet, messageHash);

  console.log(`Signing SlashVoteMessage CBOR hash: ${u8aToHex(messageHash)}`);
  console.log(`Admin pubkey: ${u8aToHex(pubkey)}`);

  const extrinsic = client.tx.oracle.voteSlash(
    nodeKey,
    vote,
    u8aToHex(pubkey) as FixedBytes<32>,
    u8aToHex(sig) as FixedBytes<64>,
  );
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

// ==================== THRESHOLD ADMIN ED25519 SIGNING EXTRINSICS ====================

/**
 * Generate (or join) a staking certificate approval.
 * Each admin calls this independently with their own admin ed25519 key.
 * When threshold is met, StakingCertificateIssued is emitted with sigs inline.
 */
export async function handleGenerateStakingCertificate(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  nodeAccount: string,
  amount: bigint,
  lockUntilBlock: number,
  cardanoPkhAdmin: string,
  cardanoPkhAggregation: string,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);

  const pkhAdminBytes = hexToU8a(
    cardanoPkhAdmin.startsWith('0x') ? cardanoPkhAdmin : `0x${cardanoPkhAdmin}`,
  );
  const pkhAggregationBytes = hexToU8a(
    cardanoPkhAggregation.startsWith('0x') ? cardanoPkhAggregation : `0x${cardanoPkhAggregation}`,
  );

  // Build StakingMessage CBOR and hash it
  const cbor = encodeStakingMessage(pkhAdminBytes, pkhAggregationBytes, amount, lockUntilBlock);
  const messageHash = hashCbor(cbor);

  // Sign with admin ed25519 key
  const { pubkey, sig } = signWithAdminKey(wallet, messageHash);

  console.log(`Signing StakingMessage CBOR hash: ${u8aToHex(messageHash)}`);
  console.log(`Admin pubkey: ${u8aToHex(pubkey)}`);

  const extrinsic = client.tx.oracle.generateStakingCertificate(
    nodeKey,
    amount,
    lockUntilBlock,
    pkhAdminBytes,
    pkhAggregationBytes,
    u8aToHex(pubkey) as FixedBytes<32>,
    u8aToHex(sig) as FixedBytes<64>,
  );
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

/**
 * Generate (or join) a withdrawal certificate approval.
 * Each admin calls this independently with their own admin ed25519 key.
 * When threshold is met, WithdrawalCertificateIssued is emitted with sigs inline.
 */
export async function handleGenerateWithdrawalCertificate(
  client: DedotClient<CardanoSidechainApi>,
  wallet: KeyringPair,
  nodeAccount: string,
): Promise<void> {
  const nodeKey = new AccountId32(nodeAccount);

  // Look up node info from chain
  const nodeInfo = await client.query.oracle.authorizedOracleNodes(nodeKey);
  if (!nodeInfo) throw new Error(`Node ${nodeAccount} not found in AuthorizedOracleNodes`);

  const rawPkh = nodeInfo.cardanoPkhAdmin as unknown as any;
  const pkhAdminBytes =
    typeof rawPkh === 'string'
      ? hexToU8a(rawPkh.startsWith('0x') ? rawPkh : `0x${rawPkh}`)
      : rawPkh?.raw
        ? new Uint8Array(rawPkh.raw)
        : new Uint8Array(rawPkh);

  // Derive approved_amount from chain state — same logic as the pallet.
  // SlashApproved: approved = stake - slash_amount.
  // RetireStake: approved = full stake, no penalty.
  const stakeAmount = BigInt((nodeInfo.stakeAmount as unknown as any).toString());
  const state = (nodeInfo.state as unknown as any).type ?? nodeInfo.state;
  let approvedAmount: bigint;
  if (state === 'SlashApproved') {
    const slashProposal = await client.query.oracle.slashProposals(nodeKey);
    if (!slashProposal) throw new Error(`No slash proposal found for ${nodeAccount}`);
    const slashAmount = BigInt((slashProposal[0] as unknown as any).toString());
    approvedAmount = stakeAmount - slashAmount;
  } else {
    approvedAmount = stakeAmount;
  }

  console.log(`Node state: ${state}, stake: ${stakeAmount}, approved: ${approvedAmount}`);

  // Build WithdrawalMessage CBOR and hash it — format unchanged
  const cbor = encodeWithdrawalMessage(pkhAdminBytes, approvedAmount);
  const messageHash = hashCbor(cbor);
  const { pubkey, sig } = signWithAdminKey(wallet, messageHash);

  console.log(`Signing WithdrawalMessage CBOR hash: ${u8aToHex(messageHash)}`);
  console.log(`Admin pubkey: ${u8aToHex(pubkey)}`);

  const extrinsic = client.tx.oracle.generateWithdrawalCertificate(
    nodeKey,
    u8aToHex(pubkey) as FixedBytes<32>,
    u8aToHex(sig) as FixedBytes<64>,
  );
  await extrinsic.signAndSend(wallet, txCallback);
  await waitForTx(client);
}

/**
 * Generate retire certificate (multisig sudo — unchanged from previous flow).
 * generate_retire_certificate remains sudo-gated and unchanged.
 */
export async function handleGenerateRetireCertificate(
  client: DedotClient<CardanoSidechainApi>,
  multisigAddresses: string[],
  threshold: number,
  wallet: KeyringPair,
  nodeAccount: string,
  lockUntilBlock: number,
  multisigStartTxId?: `0x${string}`,
): Promise<void> {
  const { createMultiAddress } = await import('./crypto.js');
  const { executeMultisigTx } = await import('../cli.js');
  const nodeKey = new AccountId32(nodeAccount);
  const multiAddr = createMultiAddress(multisigAddresses, threshold);
  // expiresAtBlock is unused in the pallet (prefixed _), pass 0
  const oracleCall = client.tx.oracle.generateRetireCertificate(nodeKey, lockUntilBlock, 0);
  const sudoCall = client.tx.sudo.sudo(oracleCall.call);
  let when;
  if (multisigStartTxId) {
    const multisigTx = await client.query.multisig.multisigs([multiAddr, multisigStartTxId]);
    if (!multisigTx) throw new Error('Multisig transaction not found');
    when = multisigTx.when;
  }
  await executeMultisigTx({ client, wallet, multisigAddresses, threshold, sudoCall, when });
}

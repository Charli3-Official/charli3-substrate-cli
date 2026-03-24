import { Command } from 'commander';
import { useSubstrateClient } from '../service/query.js';
import {
  handleGenerateStakingCertificate,
  handleConfirmCardanoStake,
  handleRequestRetire,
  handleRequestSlash,
  handleVoteSlash,
  handleGenerateWithdrawalCertificate,
  handleConfirmCardanoWithdrawal,
} from '../service/staking.js';
import { addWalletAndConfigOptions, addNodeOption, selectWallet } from '../service/cli.js';

export function createStakingCommand() {
  const stakingCommand = new Command('staking').description('Staking operations');

  // ==================== STAKE ====================

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('start-approve-stake')
        .description('Propose staking certificate — admin signs StakingMessage with ed25519 key')
        .requiredOption('--amount <amount>', 'Stake amount in lovelace')
        .requiredOption('--lock-until <block>', 'Block height until node can retire')
        .requiredOption(
          '--pkh-node-admin <pkh>',
          'Node Cardano PKH for admin key — added to OracleSettings.nodes_admin (0x prefixed hex)',
        )
        .requiredOption(
          '--pkh-node-aggregation <pkh>',
          'Node Cardano PKH for oracle key — added to OracleSettings.nodes_aggregation (0x prefixed hex)',
        ),
      'Node SS58 address',
    ),
  ).action(async (opts) => {
    const amount = BigInt(opts.amount);
    const lockUntil = parseInt(opts.lockUntil);
    console.log(
      `Proposing stake approval for ${opts.node} — amount: ${amount}, lock-until: ${lockUntil}`,
    );
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleGenerateStakingCertificate(
        client,
        wallet,
        opts.node,
        amount,
        lockUntil,
        opts.pkhNodeAdmin,
        opts.pkhNodeAggregation,
      );
    });
  });

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('sign-approve-stake')
        .description('Sign staking certificate — admin signs StakingMessage with ed25519 key')
        .requiredOption('--amount <amount>', 'Same amount as start-approve-stake')
        .requiredOption('--lock-until <block>', 'Same lock-until as start-approve-stake')
        .requiredOption('--pkh-node-admin <pkh>', 'Same pkh-node-admin as start-approve-stake')
        .requiredOption(
          '--pkh-node-aggregation <pkh>',
          'Same pkh-node-aggregation as start-approve-stake',
        ),
      'Node SS58 address',
    ),
  ).action(async (opts) => {
    const amount = BigInt(opts.amount);
    const lockUntil = parseInt(opts.lockUntil);
    console.log(`Signing stake approval for ${opts.node}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleGenerateStakingCertificate(
        client,
        wallet,
        opts.node,
        amount,
        lockUntil,
        opts.pkhNodeAdmin,
        opts.pkhNodeAggregation,
      );
    });
  });

  addWalletAndConfigOptions(
    stakingCommand
      .command('confirm-cardano-stake')
      .description('Confirm Cardano stake tx on partnerchain (single sig, node only)')
      .requiredOption('--tx-hash <hash>', 'Cardano transaction hash'),
  ).action(async (opts) => {
    console.log(`Confirming Cardano stake: ${opts.txHash}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleConfirmCardanoStake(client, wallet, opts.txHash);
    });
  });

  // ==================== WITHDRAW ====================

  addWalletAndConfigOptions(
    stakingCommand
      .command('request-retire')
      .description('Node signals intent to withdraw (single sig, node only)'),
  ).action(async (opts) => {
    console.log('Requesting retire');
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleRequestRetire(client, wallet);
    });
  });

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('start-approve-withdraw')
        .description(
          'Propose withdrawal certificate — approved amount derived from chain state (slash vote result)',
        ),
      'Node SS58 address',
    ),
  ).action(async (opts) => {
    console.log(`Proposing withdraw approval for ${opts.node}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleGenerateWithdrawalCertificate(client, wallet, opts.node);
    });
  });

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('sign-approve-withdraw')
        .description('Sign withdrawal certificate — approved amount derived from chain state'),
      'Node SS58 address',
    ),
  ).action(async (opts) => {
    console.log(`Signing withdraw approval for ${opts.node}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleGenerateWithdrawalCertificate(client, wallet, opts.node);
    });
  });

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('confirm-cardano-withdraw')
        .description('Confirm Cardano withdrawal tx on partnerchain (single sig, node only)')
        .requiredOption('--tx-hash <hash>', 'Cardano transaction hash')
        .requiredOption('--released <amount>', 'Amount released to provider')
        .requiredOption(
          '--penalty <amount>',
          'Penalty amount sent to admin wallet (0 if no penalty)',
        ),
      'Node SS58 address',
    ),
  ).action(async (opts) => {
    const released = BigInt(opts.released);
    const penalty = BigInt(opts.penalty);
    console.log(
      `Confirming withdrawal for ${opts.node} — released: ${released}, penalty: ${penalty}`,
    );
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleConfirmCardanoWithdrawal(client, wallet, opts.txHash, released, penalty);
    });
  });

  // ==================== SLASH ====================

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('request-slash')
        .description('Request to slash a node (single sig, any admin/node)')
        .requiredOption('--slash-amount <amount>', 'Amount to slash in lovelace'),
      'Node SS58 address to slash',
    ),
  ).action(async (opts) => {
    const slashAmount = BigInt(opts.slashAmount);
    console.log(`Requesting slash of ${slashAmount} from ${opts.node}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleRequestSlash(client, wallet, opts.node, slashAmount);
    });
  });

  addWalletAndConfigOptions(
    addNodeOption(
      stakingCommand
        .command('vote-slash')
        .description('Vote on slash request (single sig, each node independently)')
        .requiredOption('--vote <vote>', 'Approve or Deny'),
      'Node SS58 address being slashed',
    ),
  ).action(async (opts) => {
    const vote = opts.vote.toLowerCase() === 'approve' ? ('Approve' as const) : ('Deny' as const);
    console.log(`Voting ${vote} on slash for ${opts.node}`);
    await useSubstrateClient(opts.substrateRpc, async (client) => {
      const wallet = await selectWallet(opts.wallet);
      await handleVoteSlash(client, wallet, opts.node, vote);
    });
  });

  return stakingCommand;
}

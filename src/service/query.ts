import { DedotClient, WsProvider } from 'dedot';

import type {
  Charli3SubstrateRuntimeApi,
  PalletOracleOracleConfiguration,
} from '../charli3-substrate-runtime/index.js';

export { getCurrentConfig, useSubstrateClient };

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

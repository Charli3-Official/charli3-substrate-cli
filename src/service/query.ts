import { LegacyClient, WsProvider } from 'dedot';

import type {
  CardanoSidechainApi,
  Charli3OracleCoreConfigNodeConsensusConfiguration,
} from '../charli3-substrate-runtime/index.js';
import type { Bytes } from 'dedot/codecs';

export { getCurrentConfig, useSubstrateClient };
export type { OracleConfig, PalletOracleMessagesConfiguration };

interface OracleConfig {
  consensus: Charli3OracleCoreConfigNodeConsensusConfiguration;
  messages: PalletOracleMessagesConfiguration;
}

type PalletOracleMessagesConfiguration = [Bytes, number[]][];

async function getCurrentConfig(client: LegacyClient<CardanoSidechainApi>): Promise<OracleConfig> {
  const minNodesForTrustedAggregation = await client.query.oracle.minNodesForTrustedAggregation();
  const feedAge = await client.query.oracle.feedAge();
  const outliersRange = await client.query.oracle.outliersRange();
  const divergency = await client.query.oracle.divergency();
  const tradePairs = await client.query.oracle.tradePairs();
  const channelsToTradePairs = await client.query.oracle.channelsToTradePairs();
  if (
    minNodesForTrustedAggregation === undefined ||
    feedAge === undefined ||
    outliersRange === undefined ||
    divergency === undefined ||
    tradePairs === undefined ||
    channelsToTradePairs === undefined
  ) {
    throw new Error("Couldn't load oracle config");
  }

  return {
    consensus: {
      minNodesForTrustedAggregation,
      feedAge,
      outliersRange,
      divergency,
      tradePairs,
    },
    messages: channelsToTradePairs,
  };
}

async function useSubstrateClient(
  wsJsonRpcUrl: string,
  action: (client: LegacyClient<CardanoSidechainApi>) => Promise<void>,
) {
  let provider;
  try {
    // Connect
    provider = new WsProvider(wsJsonRpcUrl);
    const client = await LegacyClient.new<CardanoSidechainApi>(provider);
    // Use
    await action(client);
  } finally {
    // Disconnect
    if (provider) await provider.disconnect();
  }
}

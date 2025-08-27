import { DedotClient, WsProvider } from "dedot";
import { u8aToHex } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";
import type {
  Charli3SubstrateRuntimeApi,
  PalletOracleOracleConfiguration,
} from "./charli3-substrate-runtime/index.d.ts";

async function main(): Promise<void> {
  // 1. Connect
  const provider = new WsProvider("ws://127.0.0.1:9944");
  const client = await DedotClient.new<Charli3SubstrateRuntimeApi>(provider);

  // 2. Load an Ed25519 keypair
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "ed25519" });
  const alice = keyring.addFromUri(
    "bottom drive obey lake curtain smoke basket hold race lonely fit walk//Alice"
  );
  console.log("Alice pk", u8aToHex(alice.publicKey));

  let oracleConfig = await getCurrentConfig(client);
  console.log("Oracle config:", oracleConfig);
  oracleConfig.minNodesForTrustedAggregation = 3;
  oracleConfig.feedAge = 12;
  oracleConfig.outliersRange = 160;

  // 6. Sign + send
  const unsub = await client.tx.oracle
    .sudoSetConfig(oracleConfig)
    .signAndSend(alice, async ({ status, dispatchError, dispatchInfo }) => {
      console.log("Transaction status", status.type);
      if (status.type === "BestChainBlockIncluded") {
        console.log(`Transaction is included in best block`);
      }
      if (status.type === "Finalized") {
        console.log(
          `Transaction completed at block hash ${status.value.blockHash}`
        );
        await unsub();
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      console.log("Transaction status", status);
      console.log("dispatchError", dispatchError);
      console.log("dispatchInfo", dispatchInfo);
    });

  // 7. Query config
  await new Promise((resolve) => setTimeout(resolve, 3000));
  oracleConfig = await getCurrentConfig(client);
  console.log("Oracle config:", oracleConfig);

  // 8. Disconnect
  await provider.disconnect();
}

main().catch(console.error);

async function getCurrentConfig(
  client: DedotClient<Charli3SubstrateRuntimeApi>
): Promise<PalletOracleOracleConfiguration> {
  const minNodesForTrustedAggregation =
    await client.query.oracle.minNodesForTrustedAggregation();
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

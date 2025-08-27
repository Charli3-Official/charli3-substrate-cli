import { DedotClient, WsProvider } from "dedot";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";
import type { Charli3SubstrateRuntimeApi } from "./charli3-substrate-runtime/index.d.ts";

async function main() {
  // 1. Connect
  const provider = new WsProvider("ws://127.0.0.1:9944");
  const client = await DedotClient.new<Charli3SubstrateRuntimeApi>(provider);

  // 2. Load an Ed25519 keypair
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "ed25519" });
  const alice = keyring.addFromUri("//Alice");

  // 3. Hex call data (copied from polkadot.js.org/apps -> "Copy call data")
  const callData =
    "0x0602030000000c00a00000003c0000000c0c4144410c5553440c4554480c5553440c4254430c555344";

  // 4. Wrap into a Call type
  const call = client.registry.createType("Call", callData);

  // 5. Construct extrinsic
  const extrinsic = client.tx(call);

  // 6. Sign + send
  const unsub = await extrinsic.signAndSend(alice, (result) => {
    console.log("Tx status:", result.status.toString());
    if (result.status.isInBlock) {
      console.log("Included in block:", result.status.asInBlock.toHex());
      unsub();
    }
  });

  // 7. Query constants
  const minNodes = await client.query.oracle.minNodesForTrustedAggregation();
  console.log("Oracle config - min nodes for trusted aggregation:", minNodes);

  // 8. Disconnect
  await provider.disconnect();
}

main().catch(console.error);

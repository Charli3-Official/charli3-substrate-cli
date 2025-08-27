import { DedotClient, WsProvider } from "dedot";
import type { Charli3SubstrateRuntimeApi } from "./charli3-substrate-runtime/index.d.ts";

// Initialize providers & clients
const provider = new WsProvider("ws://127.0.0.1:9944");
const client = await DedotClient.new<Charli3SubstrateRuntimeApi>(provider);

// Query some constants
console.log("Existential Deposit:", client.consts.balances.existentialDeposit);

// Query oracle config
const minNodes = await client.query.oracle.minNodesForTrustedAggregation();
console.log("Oracle config - min nodes for trusted aggregation:", minNodes);

// Close the connection when done
await provider.disconnect();

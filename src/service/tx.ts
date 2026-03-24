import type { ISubmittableResult, TxPaymentInfo } from 'dedot/types';
import type { DedotClient } from 'dedot';
import type { CardanoSidechainApi } from '../charli3-substrate-runtime/index.js';

export { txCallback, waitForTx, calculateSafeWeight };

function txCallback<TxResult extends ISubmittableResult = ISubmittableResult>(
  result: TxResult,
): void {
  const { status, dispatchError, events } = result;
  console.log('Transaction status', status.type);
  if (dispatchError) {
    console.log('Dispatch error:', dispatchError.type);
    if (dispatchError.type === 'Module') {
      console.log('Dispatch module:', dispatchError.value);
    }
  }
  if (status.type === 'BestChainBlockIncluded') {
    console.log(`Transaction is included in best block`);
  }
  for (const e of events) {
    console.log(e);
  }
  if (status.type === 'Finalized') {
    console.log(`Transaction finalized at block hash ${status.value.blockHash}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitForTx(client: DedotClient<any>) {
  const waitTime = Number(client.consts.aura.slotDuration) + 1_000;
  console.log(`Waiting for ${waitTime} milliseconds (block production time + 1 sec)...`);
  await new Promise((resolve) => setTimeout(resolve, waitTime));
}

// Helper to calculate safe weight with 2x buffer
function calculateSafeWeight(estimation: TxPaymentInfo) {
  return {
    refTime: estimation.weight.refTime * 2n,
    proofSize: estimation.weight.proofSize * 2n,
  };
}

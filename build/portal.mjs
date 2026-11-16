// ─────────────────────────────────────────────────────────────────────────────
// MINTS AND BURNS — the tracker's reading of the SQD Portal (#21). Reads fund tokens' mints
// (Transfer from the zero address) and burns (Transfer to the zero address) and returns them
// as in/out token units per UTC day. Talking to the Portal (retry, deadline, batches, partial
// progress) is the shared flows core (flows-core.mjs, #47); this file says only which logs to
// ask for and how to read them. One query for all tokens of a chain, asking only for Transfers
// from or to the zero address, so busy tokens (stablecoins) stay cheap.
//
//   fetchMintsBurns({ dataset, tokens: [{ address, decimals }], fromBlock, toBlock, fetchImpl?, sleep?, maxRetries? = 30, onBatch?({ lastBlock, events, bytes }), deadline? })
//     → { events: [{ token, day: "YYYY-MM-DD", kind: "in" | "out", units, tx }], lastBlock, lastTimestamp, bytes }
//     Malformed log data is an error, not the end of the data.
//   finalizedHead(dataset) → block number;  blockAt(dataset, unixSeconds) → block number
// ─────────────────────────────────────────────────────────────────────────────

import { streamLogs, PortalError } from "./flows-core.mjs";
export { finalizedHead, blockAt, PortalError } from "./flows-core.mjs";

export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
export const ZERO_TOPIC = "0x" + "0".repeat(64); // the zero address as a log topic

export async function fetchMintsBurns({ dataset, tokens, ...rest }) {
  const decimals = new Map(tokens.map((t) => [t.address.toLowerCase(), t.decimals]));
  const address = [...decimals.keys()];
  const decode = (l, block) => {
    const token = String(l.address).toLowerCase(), t = l.topics ?? [];
    if (!decimals.has(token) || t[0] !== TRANSFER) return null;
    const isMint = t[1] === ZERO_TOPIC, isBurn = t[2] === ZERO_TOPIC;
    if (isMint === isBurn) return null; // a holder-to-holder transfer (or zero to zero) is not a flow
    const data = String(l.data);
    if (!/^0x[0-9a-fA-F]{64}/.test(data)) throw new PortalError(200, "bad_log", `block ${block.number} token ${token}: data ${data.slice(0, 20)}…`);
    const units = Number(BigInt(data.slice(0, 66))) / 10 ** decimals.get(token);
    return { token, day: block.day, kind: isMint ? "in" : "out", units, tx: l.transactionHash ?? null };
  };
  return streamLogs({
    dataset, decode, logFields: { transactionHash: true },
    logs: [
      { address, topic0: [TRANSFER], topic1: [ZERO_TOPIC] }, // mints
      { address, topic0: [TRANSFER], topic2: [ZERO_TOPIC] }, // burns
    ],
    ...rest,
  });
}

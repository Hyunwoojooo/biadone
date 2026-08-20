export const SENTINEL_START = "<<<BLABEE_M0_DECISION>>>";
export const SENTINEL_END = "<<<END_BLABEE_M0_DECISION>>>";

export function parseSentinelOnce(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const start = text.indexOf(SENTINEL_START);
  if (start === -1) return null;
  const second = text.indexOf(SENTINEL_START, start + SENTINEL_START.length);
  if (second !== -1) throw new Error("multiple_sentinels_not_supported");
  const bodyStart = start + SENTINEL_START.length;
  const end = text.indexOf(SENTINEL_END, bodyStart);
  if (end === -1 || text.indexOf(SENTINEL_END, end + SENTINEL_END.length) !== -1) {
    throw new Error("invalid_sentinel_boundary");
  }
  const encoded = text.slice(bodyStart, end).trim();
  const proposal = JSON.parse(encoded);
  if (!proposal || typeof proposal !== "object" || proposal.interaction_kind !== "blabee_decision") {
    throw new Error("invalid_sentinel_proposal");
  }
  return proposal;
}

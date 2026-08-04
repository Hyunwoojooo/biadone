/**
 * Browser-safe stable identity for generated v3 state-note items.
 *
 * Corrections are stored as overlays keyed by this value, so the generated
 * item and its evidence remain untouched.
 */
export function stateNoteItemKey(section: string, item: unknown): string {
  const generatedIdentity = JSON.stringify({
    section,
    item,
  });
  return `v3:${section}:${stableHash(generatedIdentity)}`;
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

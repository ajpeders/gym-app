/**
 * A stable key for one import attempt.
 *
 * Saving an import is a single write now, but it's a write worth retrying — it
 * can take a while and the phone can drop out mid-response. `Idempotency-Key`
 * makes the retry return the first answer instead of importing the plan twice
 * (see api/app/idempotency.py), which only works if the key is the same across
 * a retry and different across anything that isn't one:
 *
 * - tap Save again after a failure, unchanged  -> same key, replays
 * - edit the review, then Save                 -> different content, new key
 * - paste the same plan again next month       -> different nonce, new key
 *
 * So the key is the parse's nonce plus a hash of exactly what's being sent.
 */

/** FNV-1a. Not a security hash — just a short, stable digest of a payload. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

let nonceSeq = 0;

/** A fresh nonce per parse, so re-importing the same text later is a new import. */
export function newImportNonce(): string {
  nonceSeq += 1;
  return `${Date.now().toString(36)}${nonceSeq.toString(36)}`;
}

export function importKey(nonce: string, payload: unknown): string {
  return `import-${nonce}-${hash(JSON.stringify(payload))}`;
}

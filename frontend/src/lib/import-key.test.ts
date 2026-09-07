import { describe, expect, it } from 'vitest';
import { importKey, newImportNonce } from './import-key';

describe('importKey', () => {
  const payload = { name: 'PPL', workouts: [{ name: 'Push' }] };

  it('is the same for a retry of the same reviewed content', () => {
    const nonce = newImportNonce();
    // A retry must replay the first answer rather than import a second plan.
    expect(importKey(nonce, payload)).toBe(importKey(nonce, { ...payload }));
  });

  it('changes when the review is edited', () => {
    const nonce = newImportNonce();
    const edited = { ...payload, workouts: [{ name: 'Pull' }] };
    // Otherwise the edit would be silently discarded in favour of the replay.
    expect(importKey(nonce, edited)).not.toBe(importKey(nonce, payload));
  });

  it('changes when the same text is parsed again later', () => {
    // Importing the same plan twice on purpose has to stay possible.
    expect(importKey(newImportNonce(), payload)).not.toBe(
      importKey(newImportNonce(), payload),
    );
  });
});

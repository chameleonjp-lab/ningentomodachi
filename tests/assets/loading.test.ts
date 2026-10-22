import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadVerifiedSource } from '../../src/assets/loadVerifiedSource';
const bytes = readFileSync(
  'assets/android/motions/completed42-speed15/jump/android_jump.glb',
);
const expected = {
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
test('source loader verifies exact bytes, cryptographic hash and GLB before exposing source', async () => {
  const controller = new AbortController();
  const source = await loadVerifiedSource(
    async () => new Uint8Array(bytes),
    expected,
    controller.signal,
  );
  expect(source.inspection.clips[0]?.name).toBe('Jump');
  await expect(
    loadVerifiedSource(
      async () => new Uint8Array(bytes),
      { ...expected, sha256: '0'.repeat(64) },
      controller.signal,
    ),
  ).rejects.toThrow('hash');
  await expect(
    loadVerifiedSource(
      async () => bytes.subarray(0, 100),
      expected,
      controller.signal,
    ),
  ).rejects.toThrow('size');
  controller.abort();
  await expect(
    loadVerifiedSource(
      async () => new Uint8Array(bytes),
      expected,
      controller.signal,
    ),
  ).rejects.toThrow('abort');
});

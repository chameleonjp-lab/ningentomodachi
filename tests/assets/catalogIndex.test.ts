import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { durationMs } from '../../src/contracts';
import { createMotionCatalog } from '../../src/assets/motionCatalog';
import { upperBound, intervalKeyTimes } from '../../src/assets/keyIndex';
import { indexedFixture, indexedQueries } from './catalogIndexFixture';

test('indexed catalog preserves every pre-optimization root/hit/ownership sample byte for byte', async () => {
  const asset = indexedFixture(),
    catalog = createMotionCatalog(async () => [asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const values = indexedQueries.map(([from, to]) =>
      catalog.sampleMotion(
        asset.definition.clipId,
        durationMs(from),
        durationMs(to),
      ),
    );
    expect(
      createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    ).toBe('7bcc8fbd32c7c9e6c12c0682ae0b590464dd1a776d42d23598b13e22bd203c62');
  } finally {
    catalog.dispose();
  }
});

test('upper-bound lookup is logarithmic and selected boundaries retain all in-range keys and ownership splits', () => {
  let reads = 0;
  const keys = new Proxy(
    Array.from({ length: 65536 }, (_, i) => ({ atMs: i * 0.01 })),
    {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  expect(upperBound(keys, 123.45)).toBe(12346);
  expect(reads).toBeLessThanOrEqual(17);
  reads = 0;
  expect(
    intervalKeyTimes(123.45, 123.47, keys, [{ atMs: 0 }, { atMs: 123.455 }]),
  ).toEqual([123.45, 123.455, 123.46000000000001, 123.47]);
  expect(reads).toBeLessThan(24);
  expect(upperBound([], 10)).toBe(0);
  expect(upperBound([{ atMs: 1 }], 0)).toBe(0);
  expect(upperBound([{ atMs: 1 }], 1)).toBe(1);
});

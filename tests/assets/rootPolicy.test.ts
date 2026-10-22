import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import {
  copyRootPolicy,
  extractedTranslation,
  assertRootPolicyCompatibility,
} from '../../src/assets/rootPolicy';
import { indexedFixture } from './catalogIndexFixture';
const policy = {
  version: 1,
  clipId: clipId('index-equivalence'),
  sourceSha256: 'a'.repeat(64),
  mode: 'grounded-posture-y',
  provenance: {
    manifestSha256: 'b'.repeat(64),
    clipPointer: '/clips/1',
    supportPointer: '/clips/1/support_contacts',
  },
} as const;

test('explicit extraction partitions posture without mutating source displacement or guessing from clip names', () => {
  const source = { x: 0.145, y: -0.025, z: 0.01 };
  expect(extractedTranslation(source, copyRootPolicy(policy))).toEqual({
    x: 0.145,
    y: 0,
    z: 0.01,
  });
  expect(extractedTranslation(source)).toEqual(source);
  expect(source.y).toBe(-0.025);
  expect(Object.isFrozen(copyRootPolicy(policy).provenance)).toBe(true);
  for (const value of [
    { ...policy, version: 2 },
    { ...policy, mode: 'guess' },
    { ...policy, sourceSha256: 'bad' },
    { ...policy, provenance: undefined },
  ])
    expect(() => copyRootPolicy(value)).toThrow();
});

test('mixed visual/baked policy version, source, mode or provenance cannot publish compatibility', () => {
  const original = indexedFixture();
  const asset = {
    ...original,
    definition: {
      ...original.definition,
      rootCurve: original.definition.rootCurve.map((key) => ({
        ...key,
        position: { ...key.position, y: 0 },
      })),
    },
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'spatial-jump' as const,
      },
    ],
  };
  const receipt = copyRootPolicy(policy);
  expect(() =>
    assertRootPolicyCompatibility([{ asset, rootPolicy: receipt }], {
      rootPolicy: () => receipt,
    }),
  ).not.toThrow();
  expect(() =>
    assertRootPolicyCompatibility([{ asset, rootPolicy: receipt }], {
      rootPolicy: () => undefined,
    }),
  ).toThrow();
  for (const mismatch of [
    { ...receipt, mode: 'full-translation' as const },
    { ...receipt, sourceSha256: 'c'.repeat(64) },
    {
      ...receipt,
      provenance: { ...receipt.provenance, manifestSha256: 'c'.repeat(64) },
    },
  ])
    expect(() =>
      assertRootPolicyCompatibility([{ asset, rootPolicy: receipt }], {
        rootPolicy: () => mismatch,
      }),
    ).toThrow();
  expect(() =>
    assertRootPolicyCompatibility([{ asset: original, rootPolicy: receipt }], {
      rootPolicy: () => receipt,
    }),
  ).toThrow();
});

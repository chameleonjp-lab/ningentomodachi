import { expect, test } from 'vitest';
import {
  assertRootPolicyCompatibility,
  copyRootPolicy,
  extractedTranslation,
} from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
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

test('in-place posture copies an explicit receipt and extracts positive zero XYZ without changing raw source', () => {
  const receipt = copyRootPolicy({ ...policy, mode: 'in-place-posture-xyz' });
  const raw = Object.freeze({ x: 0.25, y: -0.475, z: -0 });
  expect(receipt.mode).toBe('in-place-posture-xyz');
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(Object.isFrozen(receipt.provenance)).toBe(true);
  const extracted = extractedTranslation(raw, receipt);
  for (const axis of ['x', 'y', 'z'] as const)
    expect(Object.is(extracted[axis], 0)).toBe(true);
  expect(raw).toEqual({ x: 0.25, y: -0.475, z: -0 });
  expect(extractedTranslation(raw)).toEqual(raw);
  expect(
    extractedTranslation(
      raw,
      copyRootPolicy({ ...policy, mode: 'full-translation' }),
    ),
  ).toEqual(raw);
  expect(extractedTranslation(raw, copyRootPolicy(policy))).toEqual({
    x: 0.25,
    y: 0,
    z: -0,
  });
});

test('in-place compatibility rejects every nonzero transport axis, nonspatial vertical owner and mixed policy', () => {
  const receipt = copyRootPolicy({ ...policy, mode: 'in-place-posture-xyz' });
  const original = indexedFixture();
  const asset = {
    ...original,
    definition: {
      ...original.definition,
      rootCurve: original.definition.rootCurve.map((key) => ({
        ...key,
        position: { x: 0, y: 0, z: 0 },
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
  const visuals = { rootPolicy: () => receipt };
  expect(() =>
    assertRootPolicyCompatibility([{ asset, rootPolicy: receipt }], visuals),
  ).not.toThrow();
  for (const axis of ['x', 'y', 'z'] as const) {
    const moving = {
      ...asset,
      definition: {
        ...asset.definition,
        rootCurve: asset.definition.rootCurve.map((key) => ({
          ...key,
          position: { ...key.position, [axis]: 1e-12 },
        })),
      },
    };
    expect(() =>
      assertRootPolicyCompatibility(
        [{ asset: moving, rootPolicy: receipt }],
        visuals,
      ),
    ).toThrow('In-place posture');
  }
  expect(() =>
    assertRootPolicyCompatibility(
      [
        {
          asset: {
            ...asset,
            ownership: [
              {
                atMs: durationMs(0),
                horizontalOwner: 'authored-root',
                verticalOwner: 'authored-root',
              },
            ],
          },
          rootPolicy: receipt,
        },
      ],
      visuals,
    ),
  ).toThrow('In-place posture');
  for (const mode of ['full-translation', 'grounded-posture-y'])
    expect(() =>
      assertRootPolicyCompatibility([{ asset, rootPolicy: receipt }], {
        rootPolicy: () => copyRootPolicy({ ...receipt, mode }),
      }),
    ).toThrow('Incompatible');
});

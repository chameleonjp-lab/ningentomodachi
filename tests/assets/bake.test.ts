import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import { bakeMotion } from '../../src/assets/bakeMotion';
test('baker retains fractional source times and measures root plus local limb and radius only during active windows', () => {
  const baked = bakeMotion(
    {
      clipId: clipId('sample'),
      category: 'punch',
      durationMs: durationMs(100),
      sampleRateHz: 100,
      sourceTimesMs: [12.345],
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(10),
          endMs: durationMs(90),
          damageShare: 1,
          shapeId: 'hand',
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'authored-root',
          verticalOwner: 'spatial-jump',
        },
      ],
    },
    (atMs) => ({
      root: {
        position: { x: 0, y: 0, z: atMs / 100 },
        visualYawRad: (atMs / 100) * Math.PI * 4,
      },
      shapes: [
        {
          shapeId: 'hand',
          volume: {
            kind: 'sphere',
            center: { x: 0, y: 1, z: 2 },
            radiusM: 0.2,
          },
        },
      ],
    }),
  );
  expect(baked.definition.rootCurve.some((key) => key.atMs === 12.345)).toBe(
    true,
  );
  expect(baked.definition.effectiveRangeM).toBeCloseTo(3.1);
  expect(baked.definition.rootCurve.at(-1)?.visualYawRad).toBeCloseTo(
    Math.PI * 4,
  );
});
test('baker rejects unresolved strike shapes and invalid source times rather than silently inventing geometry', () => {
  const input = {
    clipId: clipId('bad'),
    category: 'kick' as const,
    durationMs: durationMs(10),
    sampleRateHz: 100,
    sourceTimesMs: [],
    impacts: [
      {
        impactIndex: 0,
        startMs: durationMs(0),
        endMs: durationMs(10),
        damageShare: 1,
        shapeId: 'missing',
      },
    ],
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'spatial-jump' as const,
      },
    ],
  };
  expect(() =>
    bakeMotion(input, () => ({
      root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
      shapes: [],
    })),
  ).toThrow('shape');
  expect(() =>
    bakeMotion({ ...input, sourceTimesMs: [NaN] }, () => ({
      root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
      shapes: [],
    })),
  ).toThrow();
});

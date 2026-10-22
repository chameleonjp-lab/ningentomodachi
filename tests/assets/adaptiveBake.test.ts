import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import type { BakeInput, EvaluatedPose } from '../../src/assets/bakeMotion';
import { refineActiveEnvelopes } from '../../tools/assets/adaptiveBake';
const input: BakeInput = {
  clipId: clipId('measured'),
  category: 'punch',
  durationMs: durationMs(100),
  sampleRateHz: 10,
  sourceTimesMs: [0, 23.456789, 100],
  impacts: [
    {
      impactIndex: 0,
      startMs: durationMs(40),
      endMs: durationMs(60),
      damageShare: 1,
      shapeId: 'hand',
    },
  ],
  ownership: [
    {
      atMs: durationMs(0),
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ],
};
const pose = (x: number, y: number): EvaluatedPose => ({
  root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0 },
  shapes: [
    {
      shapeId: 'hand',
      volume: { kind: 'sphere', center: { x, y, z: 0 }, radiusM: 0.1 },
    },
  ],
});
test('adaptive active-window keys preserve actual radii/source times rather than silently padding geometry', async () => {
  let opened = 0,
    closed = 0;
  const result = await refineActiveEnvelopes(input, async () => {
    opened++;
    return {
      sample: (atMs) =>
        pose(
          Math.cos((atMs / 100) * Math.PI),
          Math.sin((atMs / 100) * Math.PI),
        ),
      dispose: () => {
        closed++;
      },
    };
  });
  expect(opened).toBe(closed);
  expect(result.diagnostics.addedKeyCount).toBeGreaterThan(0);
  expect(result.diagnostics.maximumMeasuredResidualM).toBeLessThanOrEqual(1e-7);
  expect(
    result.asset.definition.rootCurve.some((key) => key.atMs === 23.456789),
  ).toBe(true);
  for (const key of result.asset.shapes[0]?.keys ?? [])
    expect(key.volume.radiusM).toBe(0.1);
  for (const time of result.diagnostics.addedKeysMs) {
    expect(time).toBeGreaterThan(40);
    expect(time).toBeLessThan(60);
  }
});
test('non-convergent discontinuities fail closed and release every evaluator', async () => {
  let opened = 0,
    closed = 0;
  await expect(
    refineActiveEnvelopes(input, async () => {
      opened++;
      return {
        sample: (atMs) => pose(atMs < 50 ? 0 : 1, 0),
        dispose: () => {
          closed++;
        },
      };
    }),
  ).rejects.toThrow('converge');
  expect(opened).toBe(closed);
});

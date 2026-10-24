import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { createMeasuredJointReceipt } from '../../tools/assets/measuredJointBake';
const api = () => import('../../tools/assets/bakeKungFuSweepLowerLeg');
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
  receipt: createMeasuredJointReceipt(854),
});
function fixture(mode = 'normal') {
  const stats = { factories: 0, samples: 0, disposals: 0 };
  const factory: typeof createSourceEvaluator = async (
    _bytes,
    clip,
    shapes,
    policy,
    hooks,
  ) => {
    stats.factories++;
    expect(clip).toBe('KungFuSweep');
    expect(policy?.mode).toBe('full-translation');
    expect(shapes.map((s) => s.bone)).toEqual(['shin.R', 'foot.R']);
    expect(shapes.every((s) => s.surface === undefined)).toBe(true);
    hooks?.beforeUpdate({ stage: 'startup', atMs: 0 });
    const object = {
      surfaceSelections:
        mode === 'surface'
          ? [{ shapeId: 'unwanted', bone: 'foot.R', meshes: [] }]
          : [],
      sample(
        atMs: Parameters<
          Awaited<ReturnType<typeof createSourceEvaluator>>['sample']
        >[0],
      ) {
        expect(this).toBe(object);
        stats.samples++;
        hooks?.beforeUpdate({ stage: 'sample', atMs });
        if (mode === 'throw') throw new Error('primary sample');
        const p = atMs / 1733.3332300186157;
        const root = {
          position: {
            x: 0.4058678448200226 * p,
            y: -0.52 * Math.sin(Math.PI * p),
            z: 0.08779317140579224 * p,
          },
          visualYawRad: 2.4 * p,
        };
        const origins = [
          { x: 1, y: 0.2, z: 0.3 },
          { x: 1.4, y: 0.2, z: 0.3 },
        ];
        const volumes = shapes.map((s, i) => ({
          shapeId: s.shapeId,
          volume: {
            kind: 'sphere' as const,
            center: origins[i] ?? { x: 0, y: 0, z: 0 },
            radiusM: 123,
          },
        }));
        if (mode === 'missing') volumes.pop();
        if (mode === 'duplicate' && volumes[0] && volumes[1])
          volumes[1].shapeId = volumes[0].shapeId;
        if (mode === 'nan' && volumes[0]) volumes[0].volume.center.x = NaN;
        return { root, rawRoot: structuredClone(root), shapes: volumes };
      },
      dispose() {
        expect(this).toBe(object);
        stats.disposals++;
        if (mode === 'cleanup' || mode === 'throw')
          throw new Error('cleanup error');
      },
    };
    return object;
  };
  return { stats, factory };
}
test('actual bakeMotion uses one evaluator and exactly 853 transformed samples with one capsule', async () => {
  const { factory, stats } = fixture();
  const i = input();
  const r = await (await api()).bakeKungFuSweepLowerLeg(i, factory);
  expect(stats).toEqual({ factories: 1, samples: 853, disposals: 1 });
  expect(i.receipt.attemptedSourceUpdates).toBe(854);
  expect(i.receipt.startupUpdates).toBe(1);
  expect(r.poses.size).toBe(853);
  expect(r.asset.definition.rootCurve).toHaveLength(493);
  expect(r.asset.shapes).toHaveLength(1);
  const last = r.asset.definition.rootCurve.at(-1);
  expect(last).toMatchObject({
    position: { x: 0.4058678448200226, z: 0.08779317140579224 },
    visualYawRad: 2.4,
  });
  const pose = r.poses.get(1000);
  expect(pose?.shapes).toHaveLength(1);
  expect(pose?.shapes[0]?.volume).toEqual({
    kind: 'capsule',
    start: { x: 1, y: 0.2, z: 0.3 },
    end: { x: 1.4, y: 0.2, z: 0.3 },
    radiusM: 0.08922894361606443,
  });
  expect(r.surfaceSelections).toEqual([]);
  expect(Object.isFrozen(pose?.shapes[0]?.volume)).toBe(true);
  expect(r.poses).not.toHaveProperty('set');
});
test('source-byte rejection happens before factory acquisition', async () => {
  const { factory, stats } = fixture();
  const i = input();
  i.sourceBytes[100] = (i.sourceBytes[100] ?? 0) ^ 1;
  await expect(
    (await api()).bakeKungFuSweepLowerLeg(i, factory),
  ).rejects.toThrow(/hash/);
  expect(stats.factories).toBe(0);
});
test('budget rejects before next source sample and still disposes original receiver', async () => {
  const { factory, stats } = fixture();
  const i = input();
  i.receipt = createMeasuredJointReceipt(3);
  await expect(
    (await api()).bakeKungFuSweepLowerLeg(i, factory),
  ).rejects.toThrow(/budget/);
  expect(i.receipt.attemptedSourceUpdates).toBe(3);
  expect(i.receipt.rejectedUpdates).toBe(1);
  expect(stats.disposals).toBe(1);
});
for (const mode of ['missing', 'duplicate', 'nan', 'surface'])
  test(`rejects ${mode} endpoint contract and cleans up`, async () => {
    const { factory, stats } = fixture(mode);
    await expect(
      (await api()).bakeKungFuSweepLowerLeg(input(), factory),
    ).rejects.toThrow();
    expect(stats.factories).toBe(1);
    expect(stats.disposals).toBe(1);
  });
test('preserves primary sample failure while recording cleanup failure', async () => {
  const { factory, stats } = fixture('throw');
  const i = input();
  await expect(
    (await api()).bakeKungFuSweepLowerLeg(i, factory),
  ).rejects.toThrow('primary sample');
  expect(stats.disposals).toBe(1);
  expect(i.receipt.cleanupErrors).toHaveLength(1);
});
test('cleanup-only failure is not reported as a successful artifact', async () => {
  const { factory, stats } = fixture('cleanup');
  await expect(
    (await api()).bakeKungFuSweepLowerLeg(input(), factory),
  ).rejects.toThrow(/cleanup/);
  expect(stats.disposals).toBe(1);
});

/** Real bakeMotion/shared adapter; every evaluator supplied here is synthetic. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { createMeasuredJointReceipt } from '../../tools/assets/measuredJointBake';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const api = () =>
  import('../../tools/assets/bakeChineseAerialKneeLocalSphereCandidate');
async function setup(
  options: {
    radius?: number;
    badShape?: boolean;
    badSelection?: boolean;
    nonfinite?: boolean;
    badQuaternion?: boolean;
    sampleFailure?: Error;
    cleanupFailure?: Error;
  } = {},
) {
  const { planChineseAerialKneeLocalSphereCandidate } = await import(
    '../../tools/assets/chineseAerialKneeLocalSphereCandidate'
  );
  const bytes = input(),
    plan = planChineseAerialKneeLocalSphereCandidate(bytes),
    receipt = createMeasuredJointReceipt(647);
  let opened = 0,
    disposed = 0;
  const calls: number[] = [];
  const factory: typeof createSourceEvaluator = async (
    _bytes,
    clip,
    shapes,
    policy,
    execution,
  ) => {
    opened++;
    expect(clip).toBe('ChineseAerialKnee');
    expect(shapes).toEqual([
      {
        shapeId: plan.model.shapeId,
        bone: 'shin.R',
        radiusM: plan.model.radiusM,
      },
    ]);
    expect(policy).toEqual(plan.metadata.rootPolicy);
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    execution?.observeRootQuaternion?.({
      stage: 'startup',
      atMs: 0,
      quaternion: [0, 0, 0, 1],
    });
    return {
      surfaceSelections: options.badSelection
        ? [{ shapeId: plan.model.shapeId, bone: 'shin.R', meshes: [] }]
        : [],
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
        calls.push(atMs);
        if (options.sampleFailure) throw options.sampleFailure;
        const yaw =
          0.8 * Math.sin((atMs / plan.metadata.durationMs) * Math.PI * 1.25);
        execution?.observeRootQuaternion?.({
          stage: 'sample',
          atMs,
          quaternion: options.badQuaternion
            ? [0, 0, 0, 2]
            : [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        });
        const t = atMs / plan.metadata.durationMs,
          root = {
            position: {
              x: t * 0.1,
              y: Math.sin(t * Math.PI) * 0.6,
              z: t * 0.9,
            },
            visualYawRad: yaw,
          };
        // Synthetic articulated knee geometry: raised knee world offset; root transport remains separate.
        const center = {
          x: -0.16 + Math.sin(t) * 0.02,
          y: options.nonfinite ? NaN : 1.0 + Math.cos(t) * 0.2,
          z: 0.1 + Math.sin(t) * 0.4,
        };
        return {
          root,
          rawRoot: {
            position: {
              x: root.position.x,
              y: root.position.y - 0.082,
              z: root.position.z,
            },
            visualYawRad: yaw,
          },
          shapes: [
            {
              shapeId: options.badShape ? 'wrong' : plan.model.shapeId,
              volume: {
                kind: 'sphere',
                center,
                radiusM: options.radius ?? plan.model.radiusM,
              },
            },
          ],
        };
      },
      dispose() {
        disposed++;
        if (options.cleanupFailure) throw options.cleanupFailure;
      },
    };
  };
  return {
    bytes,
    plan,
    receipt,
    factory,
    calls,
    opened: () => opened,
    disposed: () => disposed,
    gate: {
      sourceExecutionReleased: true as const,
      sourceSha256: plan.source.sourceSha256,
      sampleTimesSha256: plan.scheduleHashes.sampleTimesMs,
      modelSha256: plan.modelSha256,
      maxSourceUpdates: 647 as const,
    },
  };
}
test('synthetic actual 532/114/646 timetable uses one shared lifecycle and 647 updates', async () => {
  const s = await setup(),
    { bakeChineseAerialKneeLocalSphereCandidate: bake } = await api();
  const r = await bake(s.bytes, s.receipt, s.gate, s.factory);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.calls).toEqual(s.plan.schedule.sampleTimesMs);
  expect(s.receipt.attemptedTimesMs).toEqual([
    0,
    ...s.plan.schedule.sampleTimesMs,
  ]);
  expect(s.receipt).toMatchObject({
    attemptedSourceUpdates: 647,
    startupUpdates: 1,
    sampleUpdates: 646,
    rejectedUpdates: 0,
  });
  expect(r.asset.definition.rootCurve).toHaveLength(532);
  expect(r.asset.shapes[0]?.keys).toHaveLength(532);
  expect(r.probes).toHaveLength(114);
  expect(r.sampledPoses).toHaveLength(646);
  expect(r.evaluationKind).toBe('synthetic-control');
  expect(r.limitation).not.toContain('nonidentity');
  expect(r.surfaceSelections).toEqual([]);
  expect(r.rootQuaternionWitnesses).toHaveLength(647);
  const yaws = r.sampledPoses.map((s) => s.pose.root.visualYawRad);
  expect(Math.max(...yaws)).toBeGreaterThan(0.7);
  expect(Math.min(...yaws)).toBeLessThan(0);
  expect(Object.isFrozen(r.sampledPoses)).toBe(true);
  expect(r.acceptance).toBeNull();
  expect(r.gameplayAllowance).toBeNull();
  const shape = r.asset.shapes[0];
  if (!shape) throw new Error('Missing synthetic shape');
  for (const key of shape.keys) {
    expect(key.volume.kind).toBe('sphere');
    if (key.volume.kind === 'sphere')
      expect(key.volume.radiusM).toBe(0.08590105297158424);
  }
  for (const sample of r.sampledPoses) {
    const t = sample.atMs / s.plan.metadata.durationMs,
      v = sample.pose.shapes[0]?.volume;
    if (!v) throw new Error('Missing synthetic volume');
    if (v.kind !== 'sphere') throw Error('sphere');
    expect(sample.pose.root.position.z + v.center.z).toBeCloseTo(
      t * 0.9 + 0.1 + Math.sin(t) * 0.4,
      14,
    );
    expect(sample.pose.root.position.y + v.center.y).toBeCloseTo(
      Math.sin(t * Math.PI) * 0.6 + 1 + Math.cos(t) * 0.2,
      14,
    );
  }
});
test('wrong gate or reused receipt fails before factory', async () => {
  const { bakeChineseAerialKneeLocalSphereCandidate: bake } = await api();
  for (const patch of [
    { modelSha256: 'wrong' },
    { sampleTimesSha256: 'wrong' },
    { sourceSha256: 'wrong' },
  ]) {
    const s = await setup();
    await expect(
      bake(s.bytes, s.receipt, { ...s.gate, ...patch }, s.factory),
    ).rejects.toThrow(/gate/);
    expect(s.opened()).toBe(0);
  }
  const s = await setup();
  s.receipt.attemptedSourceUpdates = 1;
  await expect(bake(s.bytes, s.receipt, s.gate, s.factory)).rejects.toThrow(
    /Fresh/,
  );
  expect(s.opened()).toBe(0);
});
test('wrong sphere identity radius selection and nonfinite source control fail', async () => {
  const { bakeChineseAerialKneeLocalSphereCandidate: bake } = await api();
  for (const options of [
    { radius: 0.09 },
    { badShape: true },
    { badSelection: true },
    { nonfinite: true },
    { badQuaternion: true },
  ]) {
    const s = await setup(options);
    await expect(bake(s.bytes, s.receipt, s.gate, s.factory)).rejects.toThrow();
    expect(s.opened()).toBe(1);
    expect(s.disposed()).toBe(1);
    expect(s.calls.length).toBeLessThanOrEqual(646);
  }
});
test('sample error identity survives cleanup error without second lifetime', async () => {
  const primary = new Error('sample primary'),
    cleanup = new Error('cleanup secondary'),
    s = await setup({ sampleFailure: primary, cleanupFailure: cleanup }),
    { bakeChineseAerialKneeLocalSphereCandidate: bake } = await api();
  await expect(bake(s.bytes, s.receipt, s.gate, s.factory)).rejects.toBe(
    primary,
  );
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.calls).toHaveLength(1);
  expect(s.receipt.cleanupErrors).toContain(cleanup);
});

test('altered metadata bytes fail before evaluator factory opens', async () => {
  const s = await setup();
  s.bytes.sourceBytes[100] = (s.bytes.sourceBytes[100] ?? 0) ^ 1;
  const { bakeChineseAerialKneeLocalSphereCandidate: bake } = await api();
  await expect(bake(s.bytes, s.receipt, s.gate, s.factory)).rejects.toThrow(
    /hash/,
  );
  expect(s.opened()).toBe(0);
});

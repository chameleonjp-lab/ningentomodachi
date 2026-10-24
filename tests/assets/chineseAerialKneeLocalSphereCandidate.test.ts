/** Metadata-only declaration tests: never creates a source evaluator. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const api = () =>
  import('../../tools/assets/chineseAerialKneeLocalSphereCandidate');
test('declares the receipt-derived knee-origin sphere without selecting the shin surface', async () => {
  const { planChineseAerialKneeLocalSphereCandidate } = await api();
  const p = planChineseAerialKneeLocalSphereCandidate(input());
  expect(p.model).toMatchObject({
    shapeId: 'ChineseAerialKnee:knee-local-sphere:0',
    bone: 'shin.R',
    radiusM: 0.08590105297158424,
    addedPaddingM: 0,
    sourceAuthoredAnatomy: null,
  });
  expect(p.model).not.toHaveProperty('surface');
  expect(p.model.continuousEnclosureVerified).toBe(false);
  expect(p.model.evidence.sampleFrames).toEqual(
    Array.from({ length: 84 }, (_, i) => i + 1),
  );
  expect(p.model.inheritedRadiusM).toBe(0.08590102228100256);
  expect(p.model.deltaFromInheritedM).toBe(3.0690581673264994e-8);
  expect(p.metadata.rootTransformRequirement.rootRotationInterpolation).toBe(
    'LINEAR',
  );
  expect(p.metadata.rootTransformRequirement.rootYawRangeRadians).toEqual([
    -0.07999999413967027, 0.8800005469296825,
  ]);
  expect(p.model.evidence.triangle).toBe(14435);
  expect(p.model.evidence.vertexIds).toEqual([10926, 11012, 11008]);
  expect(p.model.evidence.payloadSha256).toBe(
    '1a5f9209b83c6fefc85dcdcbebfe13d1ab08ab210d547c280989bc4bf942e01a',
  );
  expect(p.model.evidence.receiptSha256).toBe(
    'bde10401b138cf6a250d878573f3d8c5ee0fb44e872a11fafa7d36b62e5edd19',
  );
  expect(Object.isFrozen(p.model.evidence.vertexIds)).toBe(true);
  expect(p.executionReleased).toBe(false);
  expect(p.acceptance).toBeNull();
  expect(p.gameplayAllowance).toBeNull();
  expect(p.metadata.events[0]?.sourceEvent.foot_is_not_strike_surface).toBe(
    true,
  );
  expect(p.impact.startMs).toBe(755.5555701255798);
  expect(p.impact.endMs).toBe(888.8888955116272);
  expect(p.metadata.rootPolicy.mode).toBe('full-translation');
  expect(p.proposedOwnership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
});
test('independently counts native plus 240 Hz and active probes with exact hashes', async () => {
  const { planChineseAerialKneeLocalSphereCandidate } = await api();
  const p = planChineseAerialKneeLocalSphereCandidate(input());
  const candidates = new Set([
    0,
    ...p.metadata.sourceTimesSeconds.map((t) => t * 1000),
  ]);
  for (let k = 1; k < Math.ceil((p.metadata.durationMs * 240) / 1000); k++)
    candidates.add((k * 1000) / 240);
  const sorted = [...candidates].sort((a, b) => a - b),
    probes = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (a === undefined || b === undefined)
      throw new Error('Missing schedule key');
    if (a >= p.impact.startMs && b <= p.impact.endMs)
      for (const f of [0.25, 0.5, 0.75]) probes.push(a + (b - a) * f);
  }
  expect(sorted).toHaveLength(532);
  expect(probes).toHaveLength(114);
  expect(p.schedule.candidateTimesMs).toEqual(sorted);
  expect(p.schedule.probeTimesMs).toEqual(probes);
  expect(p.schedule.sampleTimesMs).toHaveLength(646);
  for (const k of [
    'candidateTimesMs',
    'probeTimesMs',
    'sampleTimesMs',
  ] as const) {
    const b = Buffer.alloc(p.schedule[k].length * 8);
    p.schedule[k].forEach((t, i) => {
      b.writeDoubleLE(t, i * 8);
    });
    expect(createHash('sha256').update(b).digest('hex')).toBe(
      p.scheduleHashes[k],
    );
  }
  expect(p.proposedBudget).toMatchObject({
    totalSourceUpdates: 647,
    sampleCalls: 646,
    measuredVertexEvaluations: 0,
    adaptiveRounds: 0,
  });
});
test('altered source bytes fail metadata gate', async () => {
  const { planChineseAerialKneeLocalSphereCandidate } = await api();
  const b = input();
  b.sourceBytes[100] = (b.sourceBytes[100] ?? 0) ^ 1;
  expect(() => planChineseAerialKneeLocalSphereCandidate(b)).toThrow(/hash/);
});

test('preserves authored identity pelvis endpoints instead of inheriting another clip assumption', async () => {
  const { planChineseAerialKneeLocalSphereCandidate } = await api();
  const bytes = input(),
    plan = planChineseAerialKneeLocalSphereCandidate(bytes);
  const length = bytes.sourceBytes.readUInt32LE(12);
  const raw = JSON.parse(
    bytes.sourceBytes.subarray(20, 20 + length).toString(),
  );
  const animation = raw.animations[17];
  const channel = animation.channels.find(
    (c: { target: { node: number; path: string } }) =>
      c.target.node === 51 && c.target.path === 'rotation',
  );
  if (!channel) throw new Error('Missing raw pelvis channel');
  expect(animation.samplers[channel.sampler]).toEqual({
    input: 678,
    interpolation: 'STEP',
    output: 681,
  });
  const accessor = raw.accessors[681],
    view = raw.bufferViews[accessor.bufferView];
  expect(accessor.count).toBe(2);
  const start =
    28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const quaternions = Array.from({ length: 2 }, (_, i) =>
    Array.from({ length: 4 }, (_, c) =>
      bytes.sourceBytes.readFloatLE(
        start + i * (view.byteStride ?? 16) + c * 4,
      ),
    ),
  );
  expect(quaternions).toEqual([
    [0, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  expect(plan.limitations.join(' ')).not.toContain('nonidentity');
});

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
const api = () => import('../../tools/assets/aerialKneeLocalSphereCandidate');
test('declares the receipt-derived knee-origin sphere without selecting the shin surface', async () => {
  const { planAerialKneeLocalSphereCandidate } = await api();
  const p = planAerialKneeLocalSphereCandidate(input());
  expect(p.model).toMatchObject({
    shapeId: 'AerialKnee:knee-local-sphere:0',
    bone: 'shin.R',
    radiusM: 0.08590102228100256,
    addedPaddingM: 0,
    sourceAuthoredAnatomy: null,
  });
  expect(p.model).not.toHaveProperty('surface');
  expect(p.model.evidence.triangle).toBe(14435);
  expect(p.model.evidence.vertexIds).toEqual([10926, 11012, 11008]);
  expect(p.model.evidence.payloadSha256).toBe(
    '090e56bf8410b7bad3f6f7aaaca9726dde709be88c1751b48126244c8e1de95c',
  );
  expect(p.model.evidence.receiptSha256).toBe(
    'f98ddba770cadf3fc3a29b6ff06269d16b305465fbf6d0972e03d8cb6925c715',
  );
  expect(Object.isFrozen(p.model.evidence.vertexIds)).toBe(true);
  expect(p.executionReleased).toBe(false);
  expect(p.acceptance).toBeNull();
  expect(p.gameplayAllowance).toBeNull();
  expect(p.metadata.events[0]?.sourceEvent.foot_is_not_strike_surface).toBe(
    true,
  );
  expect(p.impact.startMs).toBe(577.7778029441833);
  expect(p.impact.endMs).toBe(711.1111283302307);
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
  const { planAerialKneeLocalSphereCandidate } = await api();
  const p = planAerialKneeLocalSphereCandidate(input());
  const candidates = new Set([
    0,
    ...p.metadata.sourceTimesSeconds.map((t) => t * 1000),
  ]);
  for (let k = 1; k < Math.ceil((p.metadata.durationMs * 240) / 1000); k++)
    candidates.add((k * 1000) / 240);
  const sorted = [...candidates].sort((a, b) => a - b),
    probes = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!,
      b = sorted[i]!;
    if (a >= p.impact.startMs && b <= p.impact.endMs)
      for (const f of [0.25, 0.5, 0.75]) probes.push(a + (b - a) * f);
  }
  expect(sorted).toHaveLength(418);
  expect(probes).toHaveLength(114);
  expect(p.schedule.candidateTimesMs).toEqual(sorted);
  expect(p.schedule.probeTimesMs).toEqual(probes);
  expect(p.schedule.sampleTimesMs).toHaveLength(532);
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
    totalSourceUpdates: 533,
    sampleCalls: 532,
    measuredVertexEvaluations: 0,
    adaptiveRounds: 0,
  });
});
test('altered source bytes fail metadata gate', async () => {
  const { planAerialKneeLocalSphereCandidate } = await api();
  const b = input();
  b.sourceBytes[100] = (b.sourceBytes[100] ?? 0) ^ 1;
  expect(() => planAerialKneeLocalSphereCandidate(b)).toThrow(/hash/);
});

test('preserves authored identity pelvis endpoints instead of inheriting another clip assumption', async () => {
  const { planAerialKneeLocalSphereCandidate } = await api();
  const bytes = input(),
    plan = planAerialKneeLocalSphereCandidate(bytes);
  const length = bytes.sourceBytes.readUInt32LE(12);
  const raw = JSON.parse(
    bytes.sourceBytes.subarray(20, 20 + length).toString(),
  );
  const animation = raw.animations[6];
  const channel = animation.channels.find(
    (c: { target: { node: number; path: string } }) =>
      c.target.node === 51 && c.target.path === 'rotation',
  );
  expect(animation.samplers[channel.sampler]).toEqual({
    input: 194,
    interpolation: 'STEP',
    output: 198,
  });
  const accessor = raw.accessors[198],
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

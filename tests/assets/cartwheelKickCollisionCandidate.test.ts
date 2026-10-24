/** Source-free declaration tests. Original bytes are metadata only. */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const api = async () => {
  expect(
    existsSync('tools/assets/cartwheelKickCollisionCandidate.ts'),
    'declaration must exist',
  ).toBe(true);
  return import('../../tools/assets/cartwheelKickCollisionCandidate');
};
test('one left whole-foot developer model keeps phase-derived window distinct and authored root transport', async () => {
  const d = (await api()).readCartwheelKickCollisionCandidate(input());
  expect(d.shapes.map((s) => s.bone)).toEqual(['foot.L']);
  expect(new Set(d.shapes.map((s) => s.shapeId)).size).toBe(1);
  expect(
    d.impacts.map((i) => [i.impactIndex, i.damageShare, i.startMs, i.endMs]),
  ).toEqual([[0, 1, 1311.1110925674438, 1533.3333015441895]]);
  expect(d.impacts.map((i) => i.shapeId)).toEqual(
    d.shapes.map((s) => s.shapeId),
  );
  expect(d.model).toMatchObject({
    origin: 'developer-collision-abstraction',
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
  });
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d.sourceFineAnatomyAcceptance).toBeNull();
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.events[0]).toMatchObject({
    sourceFrames: null,
    diagnosticFrames: [59, 68],
    peakFrame: 66,
    windowOrigin: 'developer-provisional-phase-derived',
  });
  expect(d.nativeRootRotation.quaternions).toHaveLength(91);
  expect(d.nativeRootTranslation.positions[90]).toEqual([
    2.6750001907348633, -0.01999998278915882, 0,
  ]);
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.rootTransformRequirement.yawProjectionIsAuthoredHeading).toBe(false);
});
test('independently builds exact native plus 240Hz and active-quarter schedule', async () => {
  const d = (await api()).readCartwheelKickCollisionCandidate(input());
  const b = input().sourceBytes,
    n = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + n).toString()),
    a = j.accessors[514],
    v = j.bufferViews[a.bufferView];
  const times = Array.from(
      { length: 91 },
      (_, i) => b.readFloatLE(28 + n + (v.byteOffset ?? 0) + i * 4) * 1000,
    ),
    duration = times[90] ?? 0;
  const base = [
    ...new Set([
      0,
      duration,
      ...times,
      ...d.impacts.flatMap((i) => [i.startMs, i.endMs]),
      ...Array.from(
        { length: Math.ceil((duration * 240) / 1000) - 1 },
        (_, i) => ((i + 1) * 1000) / 240,
      ),
    ]),
  ].sort((a, b) => a - b);
  const probes: number[] = [];
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1] ?? 0,
      b = base[i] ?? 0;
    if (d.impacts.some((x) => a >= x.startMs && b <= x.endMs))
      for (const f of [0.25, 0.5, 0.75]) probes.push(a + (b - a) * f);
  }
  const all = [...new Set([...base, ...probes])].sort((a, b) => a - b);
  expect(base).toEqual(d.schedule.baseKeysMs);
  expect(all).toEqual(d.schedule.sampleKeysMs);
  expect(d.schedule).toMatchObject({
    maximumSourceUpdates: 765,
    maximumMeasuredVertexEvaluations: 1744976,
    maximumSphereMeasurements: 764,
    adaptiveCalls: 0,
  });
  expect(base).toHaveLength(575);
  expect(probes).toHaveLength(189);
  expect(all).toHaveLength(764);
  const packed = Buffer.alloc(all.length * 8);
  all.forEach((x, i) => {
    packed.writeDoubleLE(x, i * 8);
  });
  expect(createHash('sha256').update(packed).digest('hex')).toBe(
    d.schedule.sampleKeysSha256,
  );
  expect(d.schedule.sampleKeysSha256).toBe(
    '71d6aad4a48653b0325cb83e7a7f5dcaf599cf3ac32680e9938fed3f9e7a2784',
  );
});
test('metadata mutations fail closed before candidate creation', async () => {
  const a = input();
  a.sourceBytes[100] = (a.sourceBytes[100] ?? 0) ^ 1;
  const { readCartwheelKickCollisionCandidate } = await api();
  expect(() => readCartwheelKickCollisionCandidate(a)).toThrow(/hash/);
});

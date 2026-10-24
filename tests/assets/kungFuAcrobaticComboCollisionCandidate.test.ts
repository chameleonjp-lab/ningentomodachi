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
    existsSync('tools/assets/kungFuAcrobaticComboCollisionCandidate.ts'),
    'declaration must exist',
  ).toBe(true);
  return import('../../tools/assets/kungFuAcrobaticComboCollisionCandidate');
};
test('three separate impacts share an explicit unaccepted developer right-foot model', async () => {
  const d = (await api()).readKungFuAcrobaticComboCollisionCandidate(input());
  expect(d.shapes.map((s) => s.bone)).toEqual(['foot.R']);
  expect(d.impacts).toHaveLength(3);
  expect(new Set(d.impacts.map((i) => i.impactId)).size).toBe(3);
  expect(
    d.impacts.map((i) => [i.impactIndex, i.damageShare, i.startMs, i.endMs]),
  ).toEqual([
    [0, 1 / 3, 599.9999642372131, 1199.9999284744263],
    [1, 1 / 3, 1755.5556297302246, 2377.7778148651123],
    [2, 1 / 3, 3000, 3422.222137451172],
  ]);
  expect(d.model).toMatchObject({
    origin: 'developer-collision-abstraction',
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
    status: 'developer-selected-unaccepted',
  });
  expect(d.sourceStage.model).toBeNull();
  expect(d.sourceStage.geometryPolicy).toBe(
    'unresolved-no-helper-or-whole-foot-assumption',
  );
  expect(d.geometryPolicy).toBe(
    'developer-selected-whole-right-foot-unaccepted',
  );
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.events.map((e) => e.sourceFrames)).toEqual([null, null, null]);
  expect(d.events.map((e) => e.diagnosticFrames)).toEqual([
    [27, 53],
    [79, 106],
    [135, 153],
  ]);
  expect(d.events.map((e) => e.peakFrame)).toEqual([40, 94, 140]);
  expect(d.sourcePhases.airborne_intervals[1]).toEqual([79, 105]);
  expect(d.nativeRootRotation.quaternions).toHaveLength(208);
  expect(d.rootTransformRequirement.yawProjectionIsAuthoredHeading).toBe(false);
});
test('independently builds exact native plus 240Hz and active-quarter schedule', async () => {
  const d = (await api()).readKungFuAcrobaticComboCollisionCandidate(input());
  const b = input().sourceBytes,
    n = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + n).toString()),
    a = j.accessors[3402],
    v = j.bufferViews[a.bufferView];
  const times = Array.from(
      { length: 208 },
      (_, i) => b.readFloatLE(28 + n + (v.byteOffset ?? 0) + i * 4) * 1000,
    ),
    duration = times[207] ?? 0;
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
    maximumSourceUpdates: 2713,
    maximumMeasuredVertexEvaluations: 6194208,
    maximumSphereMeasurements: 2712,
    adaptiveCalls: 0,
  });
  expect(base).toHaveLength(1314);
  expect(probes).toHaveLength(1398);
  expect(all).toHaveLength(2712);
  const packed = Buffer.alloc(all.length * 8);
  all.forEach((x, i) => {
    packed.writeDoubleLE(x, i * 8);
  });
  expect(createHash('sha256').update(packed).digest('hex')).toBe(
    d.schedule.sampleKeysSha256,
  );
  expect(d.schedule.sampleKeysSha256).toBe(
    '306b1bbb7f0746222d3136ac32cc81a08697341dc6de0292d850297663ee2caf',
  );
});
test('metadata mutations fail closed before candidate creation', async () => {
  const a = input();
  a.sourceBytes[100] = (a.sourceBytes[100] ?? 0) ^ 1;
  const { readKungFuAcrobaticComboCollisionCandidate } = await api();
  expect(() => readKungFuAcrobaticComboCollisionCandidate(a)).toThrow(/hash/);
});

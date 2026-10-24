/** Source-free declaration tests. Original bytes are metadata only. */
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
const api = () => import('../../tools/assets/butterflyKickCollisionCandidate');
test('two independent developer foot models use authored sides/windows and provisional equal shares', async () => {
  const d = (await api()).readButterflyKickCollisionCandidate(input());
  expect(d.shapes.map((s) => s.bone)).toEqual(['foot.L', 'foot.R']);
  expect(new Set(d.shapes.map((s) => s.shapeId)).size).toBe(2);
  expect(
    d.impacts.map((i) => [i.impactIndex, i.damageShare, i.startMs, i.endMs]),
  ).toEqual([
    [0, 0.5, 777.7777314186096, 888.8888955116272],
    [1, 0.5, 911.1111164093018, 1066.6667222976685],
  ]);
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
  expect(d.ownership[0]).toMatchObject({
    horizontalOwner: 'authored-root',
    verticalOwner: 'authored-root',
  });
  expect(d.candidateModelStatus).toBe('developer-selected-unaccepted');
  expect(d.sourceStageModelStatus).toBe('not-selected');
  expect(d.sourceStageCompletionPath).toContain('selects no surface or model');
  expect(d.completionPath).toContain('separate visual and quantitative');
  expect(d.rootTransformRequirement.yawProjectionIsAuthoredHeading).toBe(false);
});
test('independently builds exact native plus 240Hz and active-quarter schedule', async () => {
  const d = (await api()).readButterflyKickCollisionCandidate(input());
  const b = input().sourceBytes,
    n = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + n).toString()),
    a = j.accessors[353],
    v = j.bufferViews[a.bufferView];
  const times = Array.from(
      { length: 88 },
      (_, i) => b.readFloatLE(28 + n + (v.byteOffset ?? 0) + i * 4) * 1000,
    ),
    duration = times[87] ?? 0;
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
    maximumSourceUpdates: 786,
    maximumMeasuredVertexEvaluations: 3585880,
    maximumSphereMeasurements: 1570,
    adaptiveCalls: 0,
  });
  expect(base).toHaveLength(557);
  expect(probes).toHaveLength(228);
  expect(all).toHaveLength(785);
  const packed = Buffer.alloc(all.length * 8);
  all.forEach((x, i) => {
    packed.writeDoubleLE(x, i * 8);
  });
  expect(createHash('sha256').update(packed).digest('hex')).toBe(
    d.schedule.sampleKeysSha256,
  );
  expect(d.schedule.sampleKeysSha256).toBe(
    '1e762a4631179659d0431c03650a114d2f3b1498fdd5a0a9833644b3201a5b4e',
  );
});
test('metadata mutations fail closed before candidate creation', async () => {
  const a = input();
  a.sourceBytes[100] = (a.sourceBytes[100] ?? 0) ^ 1;
  const { readButterflyKickCollisionCandidate } = await api();
  expect(() => readButterflyKickCollisionCandidate(a)).toThrow(/hash/);
});

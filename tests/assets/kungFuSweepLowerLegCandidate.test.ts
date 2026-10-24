import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
const api = () => import('../../tools/assets/kungFuSweepLowerLegCandidate');
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
test('declares only measured developer lowerleg capsule with explicit foot exclusion', async () => {
  const d = (await api()).readKungFuSweepLowerLegCandidate(input());
  expect(d.impacts).toHaveLength(1);
  expect(d.impacts[0]).toMatchObject({
    impactIndex: 0,
    startMs: 577.7778029441833,
    endMs: 1000,
    damageShare: 1,
    shapeId: 'KungFuSweep:right-lowerleg:measured-capsule-v1',
  });
  expect(d.model).toMatchObject({
    kind: 'capsule',
    startBone: 'shin.R',
    endBone: 'foot.R',
    radiusM: 0.08922894361606443,
    paddingM: 0,
    includesFoot: false,
    includesToe: false,
    allNativeGeometryCoverage: null,
    acceptance: null,
  });
  expect(d.acceptance).toBeNull();
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
});
test('pins exact full native plus fixed plus probe union without merging nearby float keys', async () => {
  const d = (await api()).readKungFuSweepLowerLegCandidate(input());
  expect(d.sourceTimesSeconds).toHaveLength(78);
  expect(d.schedule.baseKeysMs).toHaveLength(493);
  expect(d.schedule.activeIntervals).toHaveLength(120);
  expect(d.schedule.probeKeysMs).toHaveLength(360);
  expect(d.schedule.sampleKeysMs).toHaveLength(853);
  expect(d.schedule.maximumSourceUpdates).toBe(854);
  const b = Buffer.alloc(853 * 8);
  d.schedule.sampleKeysMs.forEach((v, i) => {
    b.writeDoubleLE(v, i * 8);
  });
  expect(createHash('sha256').update(b).digest('hex')).toBe(
    '9d0a15b764e2d9afb57fb458abf73d2b80aeb01a73ca0382182a00aa094bdcd1',
  );
  expect(d.schedule.sampleKeysMs).toContain(666.6666865348816);
  expect(d.schedule.sampleKeysMs).toContain(2000 / 3);
  expect(d.schedule.sampleKeysMs[0]).toBe(0);
  expect(d.durationMs).toBe(1733.3332300186157);
});
test('rejects altered source before any candidate construction and freezes model', async () => {
  const { readKungFuSweepLowerLegCandidate } = await api();
  const i = input();
  i.sourceBytes[100] = (i.sourceBytes[100] ?? 0) ^ 1;
  expect(() => readKungFuSweepLowerLegCandidate(i)).toThrow(/hash/);
  const d = readKungFuSweepLowerLegCandidate(input());
  expect(Object.isFrozen(d.model)).toBe(true);
  expect(Object.isFrozen(d.schedule.sampleKeysMs)).toBe(true);
});

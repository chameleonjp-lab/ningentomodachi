/** Source0: metadata and schedule only; no loader, mixer, skinning or bake. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const api = () => import('../../tools/assets/kickComboFourCollisionCandidate');
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});

test('source0 preserves all four authored events and separate impact identities', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  expect(d.clipId).toBe('KickCombo4');
  expect(d.events.map((e) => e.sourceEvent)).toEqual([
    {
      frame: 22,
      active_frames: [20, 23],
      limb: 'right foot',
      kind: 'front kick',
    },
    {
      frame: 43,
      active_frames: [41, 44],
      limb: 'right heel/sole',
      kind: 'side kick',
    },
    {
      frame: 68,
      active_frames: [66, 72],
      limb: 'right instep/shin',
      kind: 'roundhouse kick',
    },
    {
      frame: 106,
      active_frames: [101, 110],
      limb: 'right foot',
      kind: 'low sweep',
    },
  ]);
  expect(d.impacts.map((i) => i.impactIndex)).toEqual([0, 1, 2, 3]);
  expect(d.events.map((e) => e.sourceEventPointer)).toEqual(
    [0, 1, 2, 3].map(
      (i) => `/clips/4/attack_and_timeline_events/attack_events/${i}`,
    ),
  );
  expect(d.impacts.map((i) => i.damageShare)).toEqual([0.25, 0.25, 0.25, 0.25]);
  expect(d.impacts.reduce((sum, i) => sum + i.damageShare, 0)).toBe(1);
  expect(d.damageShareOrigin).toBe(
    'provisional-developer-balancing-not-source-fact',
  );
});

test('source0 explicitly models whole foot once without claiming narrow anatomy or slash union', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  expect(d.shapes).toEqual([
    {
      shapeId: 'KickCombo4:right-foot:dominant-subtree:collision-v1',
      bone: 'foot.R',
      surface: 'dominant-skin-subtree',
    },
  ]);
  expect(new Set(d.impacts.map((i) => i.shapeId))).toEqual(
    new Set([d.shapes[0]?.shapeId]),
  );
  expect(d.model.origin).toBe('developer-collision-abstraction');
  expect(d.model.selection).toBe('whole-right-foot-joint-subtree');
  expect(d.model.includesShin).toBe(false);
  expect(d.model.narrowPatchUnion).toBe(false);
  expect(d.events[1]?.modelInterpretation).toBe(
    'whole-foot-may-contact-other-foot-surfaces',
  );
  expect(d.events[2]?.modelInterpretation).toBe(
    'foot-side-interpretation-excludes-shin',
  );
  expect(d.model.expectedSelectionCountsByPrimitive).toEqual([
    615, 440, 386, 588, 255,
  ]);
  expect(d.model.expectedSelectedVertexCount).toBe(2284);
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d.sourceFineAnatomyAcceptance).toBeNull();
});

test('source0 uses exact positive native clock and original half-open frame-cell windows', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  expect(d.sourceTimesSeconds).toHaveLength(136);
  expect(d.sourceTimesSeconds[0]).toBe(0.02222222276031971);
  expect(d.durationMs).toBe(3022.2222805023193);
  expect(
    d.events.map((e) => [e.window.startMs, e.window.endMs, e.window.peakMs]),
  ).toEqual([
    [444.4444477558136, 533.3333611488342, 488.8888895511627],
    [911.1111164093018, 1000, 955.5554986000061],
    [1466.6666984558105, 1622.2223043441772, 1511.1111402511597],
    [2244.4443702697754, 2466.6666984558105, 2355.555534362793],
  ]);
  for (const e of d.events)
    expect(e.window.acceptance).toBe('provisional-policy');
});

test('source0 preserves native XYZ/yaw as posture rather than extracting transport', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  expect(d.rootPolicy.mode).toBe('in-place-posture-xyz');
  expect(d.rootPolicy.provenance.supportPointer).toBe(
    '/clips/4/support_contacts/support_contacts/0',
  );
  expect(d.rootTransformRequirement).toMatchObject({
    translationAccessor: 3242,
    quaternionAccessor: 3243,
    parentOffset: [0, -0.02199999988079071, 0],
    preserveAllAnimationChannels: true,
    extractedTransport: [0, 0, 0],
  });
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'spatial-movement',
      verticalOwner: 'spatial-jump',
    },
  ]);
  expect(d.rootPolicyAcceptance).toBeNull();
});

test('source0 freezes a finite 240 Hz union with three probes in every active interval', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  const s = d.schedule;
  expect(s.sampleRateHz).toBe(240);
  expect(s.baseKeysMs).toHaveLength(859);
  expect(s.activeIntervals).toHaveLength(159);
  expect(s.probeKeysMs).toHaveLength(477);
  expect(s.sampleKeysMs).toHaveLength(1336);
  expect(s.startupUpdates).toBe(1);
  expect(s.maximumSourceUpdates).toBe(1337);
  expect(s.maximumMeasuredVertexEvaluations).toBe(3051424);
  expect(s.adaptiveCalls).toBe(0);
  expect(s.baseKeysMs[0]).toBe(0);
  expect(s.baseKeysMs.at(-1)).toBe(d.durationMs);
  for (const t of d.sourceTimesSeconds)
    expect(s.baseKeysMs).toContain(t * 1000);
  for (const [a, b] of s.activeIntervals)
    for (const f of [0.25, 0.5, 0.75])
      expect(s.probeKeysMs).toContain(a + (b - a) * f);
  expect(s.sampleKeysMs).toEqual(
    [...new Set([...s.baseKeysMs, ...s.probeKeysMs])].sort((a, b) => a - b),
  );
  expect(
    s.sampleKeysMs.every(
      (t, i) =>
        Number.isFinite(t) &&
        (i === 0 || t > (s.sampleKeysMs[i - 1] ?? Infinity)),
    ),
  ).toBe(true);
});

test('source0 rejects changed source bytes and altered or rounded clocks', async () => {
  const {
    readKickComboFourCollisionCandidate,
    validateKickComboFourAccessorTimes,
  } = await api();
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const changed = input();
    changed[field][100] = (changed[field][100] ?? 0) ^ 1;
    expect(() => readKickComboFourCollisionCandidate(changed)).toThrow(/hash/);
  }
  const times = [
    ...readKickComboFourCollisionCandidate(input()).sourceTimesSeconds,
  ];
  for (const changed of [
    times.slice(1),
    [...times].reverse(),
    times.map((t) => Math.fround(t / 1.5)),
    times.map((t) => Math.round(t * 1000) / 1000),
    [NaN, ...times.slice(1)],
    [0, ...times.slice(1)],
  ])
    expect(() => validateKickComboFourAccessorTimes(changed)).toThrow();
});

test('source0 deep freezing prevents candidate or schedule mutation into approval', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const d = readKickComboFourCollisionCandidate(input());
  const frozen = (v: unknown): void => {
    if (v && typeof v === 'object') {
      expect(Object.isFrozen(v)).toBe(true);
      for (const x of Object.values(v)) frozen(x);
    }
  };
  frozen(d);
  expect(Reflect.set(d, 'acceptance', 'accepted')).toBe(false);
  expect(Reflect.set(d.model, 'includesShin', true)).toBe(false);
  expect(Reflect.set(d.schedule.sampleKeysMs, 0, 999)).toBe(false);
});

test('source0 keeps generic Float32 grid rejection as a control without changing native timestamps', async () => {
  const { readKickComboFourCollisionCandidate } = await api();
  const { inclusiveAccessorFrameWindow } = await import(
    '../../tools/assets/annotationPolicy'
  );
  const d = readKickComboFourCollisionCandidate(input());
  expect(d.sourceTimesSeconds[126]).toBe(2.8222219944000244);
  expect(() =>
    inclusiveAccessorFrameWindow({
      sourceStartFrame: 1,
      sourceEndFrame: 136,
      fps: 45,
      firstFrame: 20,
      lastFrame: 23,
      peakFrame: 22,
      accessorTimesSeconds: d.sourceTimesSeconds,
      durationMs: d.durationMs,
    }),
  ).toThrow('Unproven integer-frame/accessor correspondence');
  expect(d.clockAdaptation).toMatchObject({
    kind: 'exact-hash-pinned-native-index-mapping',
    timestampsModified: false,
    sharedToleranceModified: false,
  });
});

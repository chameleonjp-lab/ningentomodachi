import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const recipeBytes = () =>
  readFileSync(
    'tests/assets/fixtures/kungfu-hand-combo-v1/recipe.json.fixture',
  );

// Replacing five explicit events with inferred animation-name contact or reordered limbs must fail.
it('preserves all five source events and labels every generated width as provisional', async () => {
  expect(existsSync('tools/assets/kungFuHandComboDiagnostic.ts')).toBe(true);
  const { readKungFuHandComboSources } = await import(
    '../../tools/assets/kungFuHandComboDiagnostic'
  );
  const [d] = readKungFuHandComboSources(input());
  expect(d?.clipId).toBe('KungFuHandCombo5');
  expect(d?.sourceClipPointer).toBe('/clips/12');
  expect(d?.sourceTimesSeconds).toHaveLength(145);
  expect(d?.durationMs).toBe(3222.222328186035);
  expect(d?.sourceTimesSeconds[126]).toBe(2.8222219944000244);
  expect(d?.sourceTimesSeconds[142]).toBe(3.1777780055999756);
  const { inclusiveAccessorFrameWindow } = await import(
    '../../tools/assets/annotationPolicy'
  );
  if (!d) throw new Error('descriptor');
  // The generic proof must keep rejecting this export; no tolerance was widened.
  expect(() =>
    inclusiveAccessorFrameWindow({
      sourceStartFrame: 1,
      sourceEndFrame: 145,
      fps: 45,
      firstFrame: 21,
      lastFrame: 23,
      peakFrame: 22,
      accessorTimesSeconds: d.sourceTimesSeconds,
      durationMs: d.durationMs,
    }),
  ).toThrow(/Unproven/);
  expect(
    d.events.map((event) => [event.window.startMs, event.window.endMs]),
  ).toEqual([
    [466.66666865348816, 533.3333611488342],
    [933.3333373069763, 1000],
    [1444.4445371627808, 1511.1111402511597],
    [1911.1109972000122, 1977.7778387069702],
    [2377.7778148651123, 2444.444417953491],
  ]);

  expect(d?.events.map((e) => e.peakFrame)).toEqual([22, 43, 66, 87, 108]);
  expect(d?.events.map((e) => e.boneName)).toEqual([
    'hand.R',
    'hand.L',
    'hand.R',
    'forearm.R',
    'hand.L',
  ]);
  expect(d?.events.map((e) => e.sourceEvent.surface)).toEqual([
    'closed fist',
    'open upright palm heel',
    'dorsal closed fist',
    'elbow, fist beside same-side head',
    'open upright palm heel',
  ]);
  for (const [i, e] of (d?.events ?? []).entries()) {
    expect(e.sourceFrames).toBeNull();
    expect(e.diagnosticFrames).toEqual([e.peakFrame - 1, e.peakFrame + 1]);
    expect(e.windowOrigin).toBe('developer-provisional-around-source-peak');
    expect(e.sourceEventPointer).toBe(
      `/clips/12/attack_and_timeline_events/attack_events/${i}`,
    );
    expect(e.window.initialHoldEndMs).toBe(22.22222276031971);
    expect(e.acceptance).toBeNull();
  }
  expect(d?.rootPolicy.mode).toBe('grounded-posture-y');
  expect(d?.rootPolicy.provenance.supportPointer).toBe(
    '/clips/12/support_contacts/support_contacts',
  );
  expect(d?.rootPolicyAcceptance).toBeNull();
});

it('rejects source and recipe mutation before any evaluator can be constructed', async () => {
  const { readKungFuHandComboSources, validateKungFuHandComboRecipes } =
    await import('../../tools/assets/kungFuHandComboDiagnostic');
  expect(() =>
    readKungFuHandComboSources({ ...input(), sourceBytes: new Uint8Array() }),
  ).toThrow(/hash/);
  expect(() =>
    readKungFuHandComboSources({ ...input(), manifestBytes: new Uint8Array() }),
  ).toThrow(/hash/);
  expect(validateKungFuHandComboRecipes(recipeBytes())).toHaveLength(1);
  expect(() => validateKungFuHandComboRecipes(Buffer.from('{}'))).toThrow();
  const {
    validateKungFuHandComboAccessorTimes,
    KUNG_FU_HAND_COMBO_NATIVE_TIMES_SHA256,
    kungFuHandComboHash,
  } = await import('../../tools/assets/kungFuHandComboDiagnostic');
  const [d] = readKungFuHandComboSources(input());
  if (!d) throw new Error('descriptor');
  const times = [...d.sourceTimesSeconds];
  const encoded = new Uint8Array(times.length * 4);
  const view = new DataView(encoded.buffer);
  times.forEach((time, index) => {
    view.setFloat32(index * 4, time, true);
  });
  expect(kungFuHandComboHash(encoded)).toBe(
    KUNG_FU_HAND_COMBO_NATIVE_TIMES_SHA256,
  );
  expect([...encoded.slice(126 * 4, 127 * 4)]).toEqual([
    0x49, 0x9f, 0x34, 0x40,
  ]);
  expect([...encoded.slice(142 * 4, 143 * 4)]).toEqual([
    0xb7, 0x60, 0x4b, 0x40,
  ]);
  expect(() => validateKungFuHandComboAccessorTimes(times)).not.toThrow();
  const swapped = [...times];
  [swapped[126], swapped[127]] = [times[127]!, times[126]!];
  expect(() => validateKungFuHandComboAccessorTimes(swapped)).toThrow();
  const changed = [...times];
  changed[126] = Math.fround(2.8222223);
  expect(() => validateKungFuHandComboAccessorTimes(changed)).toThrow(/hash/);
  expect(() => validateKungFuHandComboAccessorTimes(times.slice(1))).toThrow();
});

it('freezes an actual 251-pose timetable without pretending it is full-duration 240 Hz', async () => {
  const { readKungFuHandComboSources } = await import(
    '../../tools/assets/kungFuHandComboDiagnostic'
  );
  const { kungFuHandComboTimetable } = await import(
    '../../tools/assets/bakeKungFuHandComboDiagnostic'
  );
  const [d] = readKungFuHandComboSources(input());
  if (!d) throw new Error('descriptor');
  const schedule = kungFuHandComboTimetable(d);
  const r = JSON.parse(
    JSON.parse(recipeBytes().toString()).originalRecipeTexts[0],
  );
  expect(schedule.bakeTimesMs).toEqual(r.timetable.bakeTimesMs);
  expect(schedule.measurementOnlyTimesMs).toEqual(
    r.timetable.measurementOnlyTimesMs,
  );
  expect(schedule.sourceEvaluationTimesMs).toEqual(
    r.timetable.sourceEvaluationTimesMs,
  );
  expect(schedule.bakeTimesMs).toHaveLength(191);
  expect(schedule.measurementOnlyTimesMs).toHaveLength(60);
  expect(schedule.sourceEvaluationTimesMs).toHaveLength(251);
});

it('retains distinct palm, dorsal, distal and elbow predicates without whole-limb fallback', async () => {
  const { clipKungFuHandComboTriangle } = await import(
    '../../tools/assets/bakeKungFuHandComboDiagnostic'
  );
  const face = {
    positions: [
      { x: 0, y: 0.02, z: 0.03 },
      { x: 0.01, y: 0.02, z: 0.03 },
      { x: 0, y: 0.03, z: 0.03 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: 1 })),
    weights: [1, 1, 1],
  };
  expect(
    clipKungFuHandComboTriangle(face, 'palmar-heel-hypothesis'),
  ).toHaveLength(3);
  expect(
    clipKungFuHandComboTriangle(face, 'posterior-elbow-band-hypothesis'),
  ).toHaveLength(3);
  expect(
    clipKungFuHandComboTriangle(face, 'dorsal-hand-hypothesis'),
  ).toHaveLength(0);
  expect(
    clipKungFuHandComboTriangle(face, 'distal-hand-hypothesis'),
  ).toHaveLength(0);
  expect(() =>
    clipKungFuHandComboTriangle(
      { ...face, weights: [NaN, 1, 1] },
      'palmar-heel-hypothesis',
    ),
  ).toThrow();
});

it('loads only a pinned five-impact candidate while retaining unaccepted qualification', async () => {
  const { loadKungFuHandComboDiagnostics } = await import(
    '../../tools/assets/kungFuHandComboDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/kungfu-hand-combo-v1/candidate.json.fixture',
  );
  const result = loadKungFuHandComboDiagnostics({
    ...input(),
    candidateBytes,
    recipeBytes: recipeBytes(),
  });
  expect(result).toHaveLength(1);
  const entry = result[0];
  expect(entry?.asset.definition.impacts).toHaveLength(5);
  expect(entry?.asset.definition.impacts.map((i) => i.damageShare)).toEqual([
    0.2, 0.2, 0.2, 0.2, 0.2,
  ]);
  expect(entry?.asset.definition.sampling.sampleRateHz).toBe(1);
  expect(entry?.regions).toHaveLength(5);
  expect(entry?.asset.definition.rootCurve.at(-1)?.position.z).toBeCloseTo(
    0.1600000262260437,
    7,
  );
  expect(
    entry?.asset.definition.rootCurve.every((k) => k.position.y === 0),
  ).toBe(true);
  expect(entry?.acceptance).toBeNull();
  expect(entry?.gameplayAllowance).toBeNull();
  expect(() =>
    loadKungFuHandComboDiagnostics({
      ...input(),
      candidateBytes: Buffer.concat([candidateBytes, Buffer.from(' ')]),
      recipeBytes: recipeBytes(),
    }),
  ).toThrow(/hash/);
});

it('cleanup preserves every primary failure and records secondary errors while draining disposers', async () => {
  const { createHandComboLifecycleReceipt, runHandComboLifecycle } =
    await import('../../tools/assets/bakeKungFuHandComboDiagnostic');
  for (const primary of [
    new Error('original source failure'),
    undefined,
    'primitive failure',
  ]) {
    const receipt = createHandComboLifecycleReceipt();
    const calls: string[] = [];
    const stopFailure = new Error('stop failed');
    const uncacheFailure = new Error('uncache failed');
    let caught = false;
    try {
      await runHandComboLifecycle(
        async () => {
          throw primary;
        },
        [
          () => {
            calls.push('resource');
          },
          () => {
            calls.push('uncache');
            throw uncacheFailure;
          },
          () => {
            calls.push('stop');
            throw stopFailure;
          },
        ],
        receipt,
      );
    } catch (error) {
      caught = true;
      expect(error).toBe(primary);
    }
    expect(caught).toBe(true);
    expect(calls).toEqual(['stop', 'uncache', 'resource']);
    expect(receipt.hasPrimaryFailure).toBe(true);
    expect(receipt.primaryFailure).toBe(primary);
    expect(receipt.cleanupFailures).toEqual([stopFailure, uncacheFailure]);
  }
});

it('cleanup fails successful work when disposal fails without inventing a primary failure', async () => {
  const { createHandComboLifecycleReceipt, runHandComboLifecycle } =
    await import('../../tools/assets/bakeKungFuHandComboDiagnostic');
  const receipt = createHandComboLifecycleReceipt();
  const secondary = new Error('resource cleanup');
  await expect(
    runHandComboLifecycle(
      async () => 42,
      [
        () => {
          throw secondary;
        },
      ],
      receipt,
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(receipt.hasPrimaryFailure).toBe(false);
  expect(receipt.cleanupFailures).toEqual([secondary]);
});

it('counter charges before callbacks including failure and denies overflow without invoking them', async () => {
  const { createHandComboCounter } = await import(
    '../../tools/assets/bakeKungFuHandComboDiagnostic'
  );
  const counter = createHandComboCounter(2);
  let calls = 0;
  const primary = new Error('evaluator failed');
  expect(() =>
    counter.run(() => {
      calls++;
      throw primary;
    }),
  ).toThrow(primary);
  expect(counter.used).toBe(1);
  counter.run(() => {
    calls++;
  });
  expect(counter.used).toBe(2);
  expect(() =>
    counter.run(() => {
      calls++;
    }),
  ).toThrow(/budget/);
  expect(calls).toBe(2);
  const mixer = createHandComboCounter(2);
  mixer.run(() => {
    calls++;
  }, 2);
  expect(() =>
    mixer.run(() => {
      calls++;
    }, 2),
  ).toThrow(/budget/);
  expect(mixer.used).toBe(2);
  const initialization = createHandComboCounter(42);
  initialization.charge(42);
  expect(() => initialization.charge()).toThrow(/budget/);
});

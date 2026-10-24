/** Source0 declaration/schedule checks only; no original posing or evaluator. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const api = () => import('../../tools/assets/flippingSlashWholeHandCandidate');
const hashTimes = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};

test('source0 declares developer whole-right-hand subtree, not authored anatomy', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  expect(plan.status).toBe('UNEXECUTED_WHOLE_HAND_CANDIDATE_PLAN');
  expect(plan.model).toMatchObject({
    origin: 'developer-selected-collision-model',
    shapeId: 'FlippingSlash:whole-hand:0',
    bone: 'hand.R',
    surface: 'dominant-skin-subtree',
    jointIndices: Array.from({ length: 16 }, (_, i) => 29 + i),
    includesForearm: false,
    narrowPatchUnion: false,
    addedPaddingM: 0,
    sourceAuthoredAnatomy: null,
  });
  expect(plan.acceptance).toBeNull();
  expect(plan.gameplayAllowance).toBeNull();
  expect(plan.executionReleased).toBe(false);
});

test('source0 preserves pinned interval, full translation and root-parent flip', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  expect(plan.metadata.events[0]?.window).toMatchObject({
    startMs: 911.1111164093018,
    peakMs: 977.7777791023254,
    endMs: 1044.4444417953491,
  });
  expect(plan.metadata.rootPolicy.mode).toBe('full-translation');
  expect(plan.metadata.rootTransformRequirement).toMatchObject({
    flipCarrier: 'root-parent-quaternion',
    preserveAllAnimationChannels: true,
    translationAxes: ['x', 'y', 'z'],
  });
  expect(plan.metadata.regionChoice).toBeNull();
  expect(plan.impact).toMatchObject({
    impactIndex: 0,
    damageShare: 1,
    shapeId: 'FlippingSlash:whole-hand:0',
  });
});

test('source0 pins exact ascending 575/111/686 proposed schedules', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  for (const [key, count, hash] of [
    [
      'candidateTimesMs',
      575,
      'f4ef3e756a604b1450f6b7bdda14d6c0668f2633d6008b159d5f26b364af2d82',
    ],
    [
      'probeTimesMs',
      111,
      '5f26cbe93ab94e7562a85c5c792d97b3b2a0e335411b9ca96112b91b17aa44fe',
    ],
    [
      'sampleTimesMs',
      686,
      '1de7d4872509a16961cbdc0cefee6f1018d2663880bc98f501a63e0aab48a9b1',
    ],
  ] as const) {
    const times = plan.schedule[key];
    expect(times).toHaveLength(count);
    expect(hashTimes(times)).toBe(hash);
    expect(
      times.every(
        (t, i) =>
          Number.isFinite(t) && (i === 0 || t > (times[i - 1] ?? Infinity)),
      ),
    ).toBe(true);
  }
  expect(plan.schedule.candidateTimesMs[0]).toBe(0);
  expect(plan.schedule.candidateTimesMs.at(-1)).toBe(2022.2222805023193);
});

test('source0 probes only active interval quarter/mid/threequarter cells', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  const keys = plan.schedule.candidateTimesMs;
  const expected: number[] = [];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (a === undefined || b === undefined) throw new Error('Missing key');
    if (a >= plan.impact.startMs && b <= plan.impact.endMs)
      for (const fraction of [0.25, 0.5, 0.75])
        expected.push(a + (b - a) * fraction);
  }
  expect(plan.schedule.probeTimesMs).toEqual(
    [...new Set(expected)].sort((a, b) => a - b),
  );
  expect(plan.schedule.sampleTimesMs).toEqual(
    [...new Set([...keys, ...expected])].sort((a, b) => a - b),
  );
});

test('source0 budgets include hidden evaluator startup and exact raw selection bounds', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  expect(plan.proposedBudget).toEqual({
    evaluatorInstances: 1,
    startupSourceUpdates: 1,
    sampleCalls: 686,
    totalSourceUpdates: 687,
    selectedVerticesPerSample: 4223,
    measuredVertexEvaluations: 2896978,
    adaptiveRounds: 0,
    rasterCalls: 0,
  });
  expect(plan.expectedSelection.primitives.map((p) => p.count)).toEqual([
    1513, 122, 1676, 912, 0,
  ]);
  expect(plan.expectedSelection.status).toBe(
    'raw-accessor-derived-expectation-not-evaluator-receipt',
  );
  expect(plan.executionReceipt).toBeNull();
});

test('source0 returned plan is deeply frozen with no admission mutation', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const plan = planFlippingSlashWholeHandCandidate(input());
  const frozen = (value: unknown): void => {
    if (value && typeof value === 'object') {
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) frozen(child);
    }
  };
  frozen(plan);
  expect(Reflect.set(plan, 'acceptance', 'approved')).toBe(false);
  expect(Reflect.set(plan.model, 'includesForearm', true)).toBe(false);
});

test('source0 rejects unpinned source bytes', async () => {
  const { planFlippingSlashWholeHandCandidate } = await api();
  const bytes = input();
  bytes.sourceBytes[100] = (bytes.sourceBytes[100] ?? 0) ^ 1;
  expect(() => planFlippingSlashWholeHandCandidate(bytes)).toThrow(/hash/);
});

test('source0 module has no evaluation, baking, cache wrapper or activation API', async () => {
  const module = await api();
  expect(Object.keys(module)).toEqual(['planFlippingSlashWholeHandCandidate']);
  const source = readFileSync(
    'tools/assets/flippingSlashWholeHandCandidate.ts',
    'utf8',
  );
  expect(source).not.toMatch(
    /GLTFLoader|AnimationMixer|createSourceEvaluator|evaluateSource|bakeMotion|from\s+['"]three|\.sample\(/,
  );
});

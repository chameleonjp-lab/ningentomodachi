/** Source-free controls: synthetic mixers only, no original source posing, loader invocation or baker invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createChineseCartwheelKickCounter,
  createChineseCartwheelKickLifecycleReceipt,
  createChineseCartwheelKickStageBudgets,
  runChineseCartwheelKickCleanupTasks,
  runChineseCartwheelKickLifecycle,
  validateChineseCartwheelKickExecutionGate,
  CHINESE_CARTWHEEL_STAGE_LIMITS,
  planChineseCartwheelKickCandidateCalls,
  deriveChineseCartwheelKickRecipe,
  runChineseCartwheelKickOwnedSource,
  selectChineseCartwheelKickSole,
  assertChineseCartwheelKickFinite,
  createChineseCartwheelKickSeeker,
  createChineseCartwheelKickPoseWriter,
  createChineseCartwheelKickRotationObserver,
} from '../../tools/assets/bakeChineseCartwheelDiagnostic';
import {
  readChineseCartwheelKickSource,
  CHINESE_CARTWHEEL_SOURCE_PINS,
} from '../../tools/assets/chineseCartwheelDiagnostic';
const descriptor = () =>
  readChineseCartwheelKickSource({
    sourceBytes: readFileSync(CHINESE_CARTWHEEL_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(CHINESE_CARTWHEEL_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createChineseCartwheelKickCounter(1);
  let attempts = 0;
  const action = () => {
    counter.charge();
    attempts++;
    throw new Error('action failed');
  };
  expect(action).toThrow('action failed');
  expect(counter.used).toBe(1);
  expect(action).toThrow('Pre-call budget');
  expect(attempts).toBe(1);
  for (const invalid of [-1, NaN, Infinity, 0.5])
    expect(() => createChineseCartwheelKickCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createChineseCartwheelKickLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runChineseCartwheelKickLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runChineseCartwheelKickCleanupTasks(
          [
            () => {
              calls.push('stop');
              throw stopFailure;
            },
            () => {
              calls.push('uncache');
              throw uncacheFailure;
            },
            () => {
              calls.push('dispose');
            },
          ],
          receipt,
        ),
      receipt,
    );
  } catch (error) {
    caught = true;
    expect(error).toBeUndefined();
  }
  expect(caught).toBe(true);
  expect(receipt.hasPrimaryFailure).toBe(true);
  expect(receipt.primaryFailure).toBeUndefined();
  expect(receipt.cleanupFailures).toEqual([stopFailure, uncacheFailure]);
  expect(calls).toEqual(['stop', 'uncache', 'dispose']);
});

test('pure cleanup-only failure rejects successful body rather than returning a candidate', async () => {
  const receipt = createChineseCartwheelKickLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runChineseCartwheelKickLifecycle(
      async () => 'candidate',
      () => {
        throw error;
      },
      receipt,
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(receipt.hasPrimaryFailure).toBe(false);
  expect(receipt.cleanupFailures).toEqual([error]);
});

test('pure candidate schedule reserves 892 attempts separately from 638 unique bake times', () => {
  const plan = planChineseCartwheelKickCandidateCalls(descriptor());
  expect(
    Object.values(CHINESE_CARTWHEEL_STAGE_LIMITS).reduce((a, b) => a + b, 0),
  ).toBe(892);
  const budgets = createChineseCartwheelKickStageBudgets();
  for (const stage of [
    'origin',
    'fit',
    'reset',
    'bake',
    'enclosure',
  ] as const) {
    expect(plan[stage]).toHaveLength(budgets[stage].limit);
    expect(Object.isFrozen(plan[stage])).toBe(true);
  }
  const bytes = Buffer.alloc(plan.enclosure.length * 8);
  plan.enclosure.forEach((time, i) => {
    bytes.writeDoubleLE(time, i * 8);
  });
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    'be03fb8b4d1aa96013fdfbc6dbc9e61f26e813bf0eae10420c51c16dbd38081d',
  );
  expect(() =>
    validateChineseCartwheelKickExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and right sole-only hypothesis without proxy copying', () => {
  const recipe = deriveChineseCartwheelKickRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('sole-only-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});

test('pure startup failure retains primary and owns cleanup before use begins', async () => {
  const receipt = createChineseCartwheelKickLifecycleReceipt();
  const failure = new Error('parse failure');
  let used = false;
  await expect(
    runChineseCartwheelKickOwnedSource(
      async () => {
        throw failure;
      },
      () => {
        used = true;
      },
      async () => 'unused',
      receipt,
    ),
  ).rejects.toBe(failure);
  expect(receipt.primaryFailure).toBe(failure);
  expect(used).toBe(false);
  const second = createChineseCartwheelKickLifecycleReceipt();
  const calls: string[] = [];
  await expect(
    runChineseCartwheelKickOwnedSource(
      async () => ({ marker: 1 }),
      () => {
        calls.push('cleanup');
      },
      async () => {
        calls.push('use');
        throw failure;
      },
      second,
    ),
  ).rejects.toBe(failure);
  expect(calls).toEqual(['use', 'cleanup']);
});

test('pure source seeker rejects wrong times and precharges throwing mixer calls', () => {
  const d = descriptor();
  const receipt = createChineseCartwheelKickLifecycleReceipt();
  let calls = 0;
  const seek = createChineseCartwheelKickSeeker(d, receipt, () => {
    calls++;
    throw new Error('mixer');
  });
  expect(() => seek(1, 'origin')).toThrow(/Unplanned/);
  expect(calls).toBe(0);
  expect(() => seek(0, 'origin')).toThrow('mixer');
  expect(receipt.attempts).toEqual([{ stage: 'origin', atMs: 0 }]);
  expect(() => seek(0, 'origin')).toThrow();
  expect(calls).toBe(1);
});

test('pure sole selection excludes heel-only faces and clips original sole corners', () => {
  const heel = {
    positions: [
      { x: 0, y: 0.1, z: -0.1 },
      { x: 1, y: 0.1, z: -0.1 },
      { x: 0, y: 0.11, z: -0.1 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -1 })),
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  expect(selectChineseCartwheelKickSole(heel)).toEqual([]);
  const sole = {
    ...heel,
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0.1, z: 1 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: -1, z: 0 })),
  };
  const corners = selectChineseCartwheelKickSole(sole);
  expect(corners.length).toBeGreaterThan(2);
  expect(
    corners.some((corner) => corner.some((weight) => weight > 0 && weight < 1)),
  ).toBe(true);
  for (const corner of corners)
    expect(corner.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 12);
});

test('pure serialization guard rejects every nested nonfinite number but keeps signed values and nulls', () => {
  for (const bad of [Infinity, -Infinity, NaN])
    expect(() =>
      assertChineseCartwheelKickFinite({ inactive: [{ matrix: [0, bad] }] }),
    ).toThrow(/finite/);
  expect(() =>
    assertChineseCartwheelKickFinite({
      escape: 1e-7,
      support: -0.001,
      qualification: null,
    }),
  ).not.toThrow();
});

test('pure actual pose writer preserves constant nonrest tracks across repeated and nonmonotonic seeks', async () => {
  const {
    AnimationMixer,
    AnimationClip,
    NumberKeyframeTrack,
    Group,
    LoopOnce,
  } = await import('three');
  const allocate = () => {
    const scene = new Group();
    const baseline = [
      {
        node: scene,
        position: scene.position.clone(),
        quaternion: scene.quaternion.clone(),
        scale: scene.scale.clone(),
      },
    ];
    const mixer = new AnimationMixer(scene);
    const clip = new AnimationClip('synthetic-constant-and-varying', 1, [
      new NumberKeyframeTrack('.position[y]', [0, 1], [2, 2]),
      new NumberKeyframeTrack('.position[x]', [0, 1], [1, 3]),
      new NumberKeyframeTrack('.scale[x]', [0, 1], [0.8, 0.8]),
    ]);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    return { scene, mixer, action, baseline };
  };
  const dispose = (r: ReturnType<typeof allocate>) => {
    try {
      r.mixer.stopAllAction();
    } finally {
      r.mixer.uncacheRoot(r.scene);
    }
  };
  const snapshot = (r: ReturnType<typeof allocate>) => ({
    position: r.scene.position.toArray(),
    scale: r.scene.scale.toArray(),
  });
  const persistent = allocate();
  try {
    const write = createChineseCartwheelKickPoseWriter(
      persistent.scene,
      persistent.mixer,
      persistent.action,
      persistent.baseline,
    );
    for (const atMs of [0, 0, 500, 500, 250, 1000, 250]) {
      const fresh = allocate();
      try {
        fresh.action.time = atMs / 1000;
        fresh.mixer.update(0);
        fresh.scene.updateMatrixWorld(true);
        write(atMs);
        expect(
          snapshot(persistent),
          `actual writer at ${atMs}ms must match fresh mixer`,
        ).toEqual(snapshot(fresh));
      } finally {
        dispose(fresh);
      }
    }
  } finally {
    dispose(persistent);
  }
});

test('pure rotation observer keeps signed cartwheel quaternion roll separate from zero yaw', () => {
  const observe = createChineseCartwheelKickRotationObserver();
  const q = Math.SQRT1_2;
  const input = [
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: 0, z: -q, w: q },
    { x: 0, y: 0, z: -1, w: 0 },
    { x: 0, y: 0, z: -q, w: -q },
    { x: 0, y: 0, z: 0, w: -1 },
  ];
  const rows = input.map(observe);
  expect(rows.map((r) => r.quaternion)).toEqual(input);
  expect(rows.every((r) => r.visualYawRad === 0)).toBe(true);
  expect(rows.at(-1)?.zRollRad).toBeCloseTo(-Math.PI * 2, 12);
  expect(() => observe({ x: NaN, y: 0, z: 0, w: 1 })).toThrow();
});

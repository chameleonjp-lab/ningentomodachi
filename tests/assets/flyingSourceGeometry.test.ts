/** Source-free controls: synthetic mixers only, no original source posing, loader invocation or baker invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createFlyingCounter,
  createFlyingLifecycleReceipt,
  createFlyingStageBudgets,
  runFlyingCleanupTasks,
  runFlyingLifecycle,
  validateFlyingExecutionGate,
  FLYING_STAGE_LIMITS,
  planFlyingCandidateCalls,
  deriveFlyingRecipe,
  runFlyingOwnedSource,
  selectFlyingSole,
  assertFlyingFinite,
  createFlyingSeeker,
  createFlyingPoseWriter,
  createFlyingRotationObserver,
} from '../../tools/assets/bakeFlyingDiagnostic';
import {
  readFlyingSource,
  FLYING_SOURCE_PINS,
} from '../../tools/assets/flyingDiagnostic';
const descriptor = () =>
  readFlyingSource({
    sourceBytes: readFileSync(FLYING_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(FLYING_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createFlyingCounter(1);
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
    expect(() => createFlyingCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createFlyingLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runFlyingLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runFlyingCleanupTasks(
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
  const receipt = createFlyingLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runFlyingLifecycle(
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

test('pure candidate schedule reserves 747 attempts separately from 493 unique bake times', () => {
  const plan = planFlyingCandidateCalls(descriptor());
  expect(Object.values(FLYING_STAGE_LIMITS).reduce((a, b) => a + b, 0)).toBe(
    747,
  );
  const budgets = createFlyingStageBudgets();
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
    '0f4e198d4fac2236b8e8c61048bcc0b432a3d836e838bdc88659df3892c4cc8c',
  );
  expect(() =>
    validateFlyingExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and right sole-only hypothesis without proxy copying', () => {
  const recipe = deriveFlyingRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('sole-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});

test('pure startup failure retains primary and owns cleanup before use begins', async () => {
  const receipt = createFlyingLifecycleReceipt();
  const failure = new Error('parse failure');
  let used = false;
  await expect(
    runFlyingOwnedSource(
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
  const second = createFlyingLifecycleReceipt();
  const calls: string[] = [];
  await expect(
    runFlyingOwnedSource(
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
  const receipt = createFlyingLifecycleReceipt();
  let calls = 0;
  const seek = createFlyingSeeker(d, receipt, () => {
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

test('pure sole selection clips original barycentrics without heel union or normal broadening', () => {
  const positions = [
    { x: 0, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 0, y: 0.1, z: 0.2 },
  ];
  const normals = positions.map(() => ({ x: 0, y: -1, z: 0 }));
  const face = {
    positions,
    normals,
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  const corners = selectFlyingSole(face);
  expect(corners.length).toBeGreaterThan(2);
  expect(corners.some((corner) => corner.some((v) => v > 0 && v < 1))).toBe(
    true,
  );
  expect(
    selectFlyingSole({
      ...face,
      normals: normals.map(() => ({ x: 0, y: 1, z: 0 })),
    }),
  ).toEqual([]);
  expect(selectFlyingSole({ ...face, footWeights: [0, 0, 0] })).toEqual([]);
  expect(() => selectFlyingSole({ ...face, normals: [] })).toThrow();
});

test('pure serialization guard rejects every nested nonfinite number but keeps signed values and nulls', () => {
  for (const bad of [Infinity, -Infinity, NaN])
    expect(() =>
      assertFlyingFinite({ inactive: [{ matrix: [0, bad] }] }),
    ).toThrow(/finite/);
  expect(() =>
    assertFlyingFinite({
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
    const write = createFlyingPoseWriter(
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

test('pure rotation observer preserves native identity quaternion and zero yaw without reconstruction', () => {
  const observe = createFlyingRotationObserver();
  const q = { x: 0, y: 0, z: 0, w: 1 };
  expect(observe(q)).toEqual({ quaternion: q, visualYawRad: 0 });
  expect(observe(q)).toEqual({ quaternion: q, visualYawRad: 0 });
  expect(() => observe({ x: NaN, y: 0, z: 0, w: 1 })).toThrow();
});

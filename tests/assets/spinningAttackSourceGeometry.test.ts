/** Source-free controls: synthetic mixers only, no original source posing, loader invocation or baker invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createSpinningAttackCounter,
  createSpinningAttackLifecycleReceipt,
  createSpinningAttackStageBudgets,
  runSpinningAttackCleanupTasks,
  runSpinningAttackLifecycle,
  validateSpinningAttackExecutionGate,
  SPINNING_ATTACK_STAGE_LIMITS,
  planSpinningAttackCandidateCalls,
  deriveSpinningAttackRecipe,
  runSpinningAttackOwnedSource,
  selectSpinningAttackHeel,
  assertSpinningAttackFinite,
  createSpinningAttackSeeker,
  createSpinningAttackPoseWriter,
} from '../../tools/assets/bakeSpinningAttackDiagnostic';
import {
  readSpinningAttackSource,
  SPINNING_ATTACK_SOURCE_PINS,
} from '../../tools/assets/spinningAttackDiagnostic';
const descriptor = () =>
  readSpinningAttackSource({
    sourceBytes: readFileSync(SPINNING_ATTACK_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(SPINNING_ATTACK_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createSpinningAttackCounter(1);
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
    expect(() => createSpinningAttackCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createSpinningAttackLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runSpinningAttackLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runSpinningAttackCleanupTasks(
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
  const receipt = createSpinningAttackLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runSpinningAttackLifecycle(
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

test('pure candidate schedule reserves 721 attempts separately from 557 unique bake times', () => {
  const plan = planSpinningAttackCandidateCalls(descriptor());
  expect(
    Object.values(SPINNING_ATTACK_STAGE_LIMITS).reduce((a, b) => a + b, 0),
  ).toBe(721);
  const budgets = createSpinningAttackStageBudgets();
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
    'ed606840cdb8265e61618daa9a3896134fe860ee1b2598a6f4eacb16f9229682',
  );
  expect(() =>
    validateSpinningAttackExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and right heel-only hypothesis without proxy copying', () => {
  const recipe = deriveSpinningAttackRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('heel-only-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});

test('pure startup failure retains primary and owns cleanup before use begins', async () => {
  const receipt = createSpinningAttackLifecycleReceipt();
  const failure = new Error('parse failure');
  let used = false;
  await expect(
    runSpinningAttackOwnedSource(
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
  const second = createSpinningAttackLifecycleReceipt();
  const calls: string[] = [];
  await expect(
    runSpinningAttackOwnedSource(
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
  const receipt = createSpinningAttackLifecycleReceipt();
  let calls = 0;
  const seek = createSpinningAttackSeeker(d, receipt, () => {
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

test('pure heel selection excludes sole-only triangles and preserves clipped original faces', () => {
  const sole = {
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: -1, z: 0 })),
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  expect(selectSpinningAttackHeel(sole)).toEqual([]);
  const heel = {
    ...sole,
    positions: [
      { x: 0, y: 0, z: -0.1 },
      { x: 1, y: 0, z: -0.1 },
      { x: 0, y: 0.2, z: -0.1 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -1 })),
  };
  const corners = selectSpinningAttackHeel(heel);
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
      assertSpinningAttackFinite({ inactive: [{ matrix: [0, bad] }] }),
    ).toThrow(/finite/);
  expect(() =>
    assertSpinningAttackFinite({
      escape: 1e-7,
      support: -0.001,
      qualification: null,
    }),
  ).not.toThrow();
});

/** Narrow Three characterization: external baseline writes bypass PropertyMixer
 * caches. This tests the suspected failure mechanism, not source geometry. */
test('pure constant-track control proves manual baseline reset breaks cached mixer writes', async () => {
  const {
    AnimationMixer,
    AnimationClip,
    NumberKeyframeTrack,
    Group,
    LoopOnce,
  } = await import('three');
  const run = (manualReset: boolean) => {
    const scene = new Group();
    const mixer = new AnimationMixer(scene);
    const clip = new AnimationClip('synthetic-plateau', 1, [
      new NumberKeyframeTrack('.position[y]', [0, 1], [2, 2]),
    ]);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    try {
      action.time = 0;
      mixer.update(0);
      const first = scene.position.y;
      if (manualReset) scene.position.set(0, 0, 0);
      action.time = 0.5;
      mixer.update(0);
      return { first, second: scene.position.y };
    } finally {
      try {
        mixer.stopAllAction();
      } finally {
        mixer.uncacheRoot(scene);
      }
    }
  };
  expect(run(false)).toEqual({ first: 2, second: 2 });
  expect(run(true)).toEqual({ first: 2, second: 0 });
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
    const write = createSpinningAttackPoseWriter(
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

/** LowSweep diagnostic preparation dated 2026-10-23. No source execution authority. */
/** Source-free controls: synthetic mixers only, no original source posing, loader invocation or baker invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createLowSweepCounter,
  createLowSweepLifecycleReceipt,
  createLowSweepStageBudgets,
  runLowSweepCleanupTasks,
  runLowSweepLifecycle,
  validateLowSweepExecutionGate,
  LOW_SWEEP_STAGE_LIMITS,
  planLowSweepCandidateCalls,
  deriveLowSweepRecipe,
  runLowSweepOwnedSource,
  selectLowSweepShin,
  assertLowSweepFinite,
  createLowSweepSeeker,
  createLowSweepPoseWriter,
  createLowSweepRotationObserver,
  createLowSweepShinFrame,
} from '../../tools/assets/bakeLowSweepDiagnostic';
import {
  readLowSweepSource,
  LOW_SWEEP_SOURCE_PINS,
} from '../../tools/assets/lowSweepDiagnostic';
const descriptor = () =>
  readLowSweepSource({
    sourceBytes: readFileSync(LOW_SWEEP_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(LOW_SWEEP_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createLowSweepCounter(1);
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
    expect(() => createLowSweepCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createLowSweepLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runLowSweepLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runLowSweepCleanupTasks(
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
  const receipt = createLowSweepLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runLowSweepLifecycle(
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

test('pure candidate schedule reserves 797 attempts separately from 348 unique bake times', () => {
  const plan = planLowSweepCandidateCalls(descriptor());
  expect(Object.values(LOW_SWEEP_STAGE_LIMITS).reduce((a, b) => a + b, 0)).toBe(
    797,
  );
  const budgets = createLowSweepStageBudgets();
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
    'fe98f175dd6d052a618772a5f3c5b887cb00f790828fd43daf63d5c9419bf50d',
  );
  expect(() =>
    validateLowSweepExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and provisional anterior-shin-only hypothesis without proxy copying', () => {
  const recipe = deriveLowSweepRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('anterior-shin-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});

test('pure startup failure retains primary and owns cleanup before use begins', async () => {
  const receipt = createLowSweepLifecycleReceipt();
  const failure = new Error('parse failure');
  let used = false;
  await expect(
    runLowSweepOwnedSource(
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
  const second = createLowSweepLifecycleReceipt();
  const calls: string[] = [];
  await expect(
    runLowSweepOwnedSource(
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
  const receipt = createLowSweepLifecycleReceipt();
  let calls = 0;
  const seek = createLowSweepSeeker(d, receipt, () => {
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

test('pure anterior-shin selection uses genuine shin transforms without region broadening', async () => {
  const { Matrix4 } = await import('three');
  const frame = createLowSweepShinFrame(
    new Matrix4().makeTranslation(0, -2, 0),
    new Matrix4().makeTranslation(1, 0, 0),
  );
  const positions = [
    { x: 0, y: 2.1, z: -0.1 },
    { x: 0.1, y: 2.1, z: -0.1 },
    { x: 0, y: 2.5, z: -0.1 },
  ];
  const normals = positions.map(() => ({ x: 0, y: 0, z: -1 }));
  expect(frame.positions(positions)[0]?.x).toBe(1);
  expect(frame.positions(positions)[0]?.y).toBeCloseTo(0.1, 12);
  expect(frame.positions(positions)[0]?.z).toBe(-0.1);
  expect(frame.normals(normals)).toEqual(normals);
  const face = {
    positions,
    normals,
    shinPositions: frame.positions(positions),
    shinNormals: frame.normals(normals),
    shinWeights: [1, 1, 1],
    footWeights: [0, 0, 0],
    toeWeights: [0, 0, 0],
  };
  const corners = selectLowSweepShin(face);
  expect(corners.length).toBeGreaterThan(2);
  expect(corners.some((c) => c.some((v) => v > 0 && v < 1))).toBe(true);
  expect(
    selectLowSweepShin({
      ...face,
      shinNormals: normals.map(() => ({ x: 0, y: 0, z: 1 })),
    }),
  ).toEqual([]);
  expect(() => selectLowSweepShin({ ...face, shinNormals: [] })).toThrow();
  expect(() =>
    createLowSweepShinFrame(new Matrix4().makeScale(0, 1, 1), new Matrix4()),
  ).toThrow();
});

test('pure serialization guard rejects every nested nonfinite number but keeps signed values and nulls', () => {
  for (const bad of [Infinity, -Infinity, NaN])
    expect(() =>
      assertLowSweepFinite({ inactive: [{ matrix: [0, bad] }] }),
    ).toThrow(/finite/);
  expect(() =>
    assertLowSweepFinite({
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
    const write = createLowSweepPoseWriter(
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

test('pure rotation observer preserves reversible native-style Y turns without reconstruction', async () => {
  const { Quaternion, Euler } = await import('three');
  const observe = createLowSweepRotationObserver();
  const input = [0, -0.22, 0.4, 0].map((yaw) => {
    const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0, 'YXZ'));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  });
  const rows = input.map(observe);
  expect(rows.map((r) => r.quaternion)).toEqual(input);
  expect(rows.at(-1)?.visualYawRad).toBeCloseTo(0, 12);
  expect(() => observe({ x: NaN, y: 0, z: 0, w: 1 })).toThrow();
});

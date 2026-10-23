/** Reconstruction dated 2026-10-23T21:17Z from published main e69c98aa.
 * New unverified implementation, not recovered historical Tornado bytes or test evidence. */
/** Source-free controls: synthetic mixers only, no original source posing, loader invocation or baker invocation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createTornadoCounter,
  createTornadoLifecycleReceipt,
  createTornadoStageBudgets,
  runTornadoCleanupTasks,
  runTornadoLifecycle,
  validateTornadoExecutionGate,
  TORNADO_STAGE_LIMITS,
  planTornadoCandidateCalls,
  deriveTornadoRecipe,
  runTornadoOwnedSource,
  selectTornadoInstep,
  assertTornadoFinite,
  createTornadoSeeker,
  createTornadoPoseWriter,
  createTornadoRotationObserver,
  createTornadoShinFrame,
} from '../../tools/assets/bakeTornadoDiagnostic';
import {
  readTornadoSource,
  TORNADO_SOURCE_PINS,
} from '../../tools/assets/tornadoDiagnostic';
const descriptor = () =>
  readTornadoSource({
    sourceBytes: readFileSync(TORNADO_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(TORNADO_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createTornadoCounter(1);
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
    expect(() => createTornadoCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createTornadoLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runTornadoLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runTornadoCleanupTasks(
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
  const receipt = createTornadoLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runTornadoLifecycle(
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

test('pure candidate schedule reserves 921 attempts separately from 632 unique bake times', () => {
  const plan = planTornadoCandidateCalls(descriptor());
  expect(Object.values(TORNADO_STAGE_LIMITS).reduce((a, b) => a + b, 0)).toBe(
    921,
  );
  const budgets = createTornadoStageBudgets();
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
    'fc3fc2756862eced40a6a22d40a10aa74f2832d9527d585e4371c98ca773db07',
  );
  expect(() =>
    validateTornadoExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and right instep-only hypothesis without proxy copying', () => {
  const recipe = deriveTornadoRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('instep-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});

test('pure startup failure retains primary and owns cleanup before use begins', async () => {
  const receipt = createTornadoLifecycleReceipt();
  const failure = new Error('parse failure');
  let used = false;
  await expect(
    runTornadoOwnedSource(
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
  const second = createTornadoLifecycleReceipt();
  const calls: string[] = [];
  await expect(
    runTornadoOwnedSource(
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
  const receipt = createTornadoLifecycleReceipt();
  let calls = 0;
  const seek = createTornadoSeeker(d, receipt, () => {
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

test('pure instep selection uses genuine shin transforms without region broadening', async () => {
  const { Matrix4 } = await import('three');
  const frame = createTornadoShinFrame(
    new Matrix4().makeTranslation(0, -2, 0),
    new Matrix4().makeTranslation(1, 0, 0),
  );
  const positions = [
    { x: 0, y: 0.1, z: 0.1 },
    { x: 0.1, y: 0.1, z: 0.1 },
    { x: 0, y: 0.1, z: 0.3 },
  ];
  const normals = positions.map(() => ({ x: 0, y: 1, z: 0 }));
  expect(frame.positions(positions)[0]).toEqual({ x: 1, y: -1.9, z: 0.1 });
  expect(frame.normals(normals)).toEqual(normals);
  const face = {
    positions,
    normals,
    shinPositions: frame.positions(positions),
    shinNormals: frame.normals(normals),
    shinWeights: [0, 0, 0],
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  const corners = selectTornadoInstep(face);
  expect(corners.length).toBeGreaterThan(2);
  expect(corners.some((c) => c.some((v) => v > 0 && v < 1))).toBe(true);
  expect(
    selectTornadoInstep({
      ...face,
      normals: normals.map(() => ({ x: 0, y: -1, z: 0 })),
    }),
  ).toEqual([]);
  expect(() => selectTornadoInstep({ ...face, shinNormals: [] })).toThrow();
  expect(() =>
    createTornadoShinFrame(new Matrix4().makeScale(0, 1, 1), new Matrix4()),
  ).toThrow();
});

test('pure serialization guard rejects every nested nonfinite number but keeps signed values and nulls', () => {
  for (const bad of [Infinity, -Infinity, NaN])
    expect(() =>
      assertTornadoFinite({ inactive: [{ matrix: [0, bad] }] }),
    ).toThrow(/finite/);
  expect(() =>
    assertTornadoFinite({
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
    const write = createTornadoPoseWriter(
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

test('pure rotation observer retains mixed quaternion and positive yaw without reconstruction', async () => {
  const { Quaternion, Euler } = await import('three');
  const observe = createTornadoRotationObserver();
  const input = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2].map(
    (yaw) => {
      const q = new Quaternion().setFromEuler(
        new Euler(0.12, yaw, 0.06, 'YXZ'),
      );
      return { x: q.x, y: q.y, z: q.z, w: q.w };
    },
  );
  const rows = input.map(observe);
  expect(rows.map((r) => r.quaternion)).toEqual(input);
  expect(rows.at(-1)?.visualYawRad).toBeCloseTo(Math.PI * 2, 12);
  expect(() => observe({ x: NaN, y: 0, z: 0, w: 1 })).toThrow();
});

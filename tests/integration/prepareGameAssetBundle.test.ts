import { Group } from 'three';
import { expect, test, vi } from 'vitest';
import { prepareGameAssetBundle } from '../../src/app/prepareGameAssetBundle';
import type { ClipRootPolicy } from '../../src/assets/rootPolicy';
import type { ThreeAssetPack } from '../../src/assets/threeAssetPack';
import { clipId, durationMs } from '../../src/contracts';

function inputs() {
  const asset = {
    definition: {
      clipId: 'TestAttack',
      category: 'kick',
      durationMs: 100,
      effectiveRangeM: 1,
      impacts: [
        {
          impactIndex: 0,
          startMs: 20,
          endMs: 40,
          damageShare: 1,
          shapeId: 'hit',
        },
      ],
      rootCurve: [0, 100].map((atMs) => ({
        atMs,
        position: { x: 0, y: 0, z: 0 },
        visualYawRad: 0,
      })),
      sampling: {
        version: 1,
        sampleRateHz: 60,
        interpolation: 'piecewise-linear',
      },
    },
    shapes: [
      {
        shapeId: 'hit',
        keys: [0, 100].map((atMs) => ({
          atMs,
          volume: {
            kind: 'sphere',
            center: { x: 0, y: 0, z: 0 },
            radiusM: 0.1,
          },
        })),
      },
    ],
    ownership: [
      {
        atMs: 0,
        horizontalOwner: 'authored-root',
        verticalOwner: 'spatial-jump',
      },
    ],
  };
  const policy: ClipRootPolicy = {
    version: 1,
    clipId: clipId('TestAttack'),
    sourceSha256: 'a'.repeat(64),
    mode: 'grounded-posture-y',
    provenance: {
      manifestSha256: 'b'.repeat(64),
      clipPointer: '/clips/0',
      supportPointer: '/clips/0/support_contacts',
    },
  };
  const dispose = vi.fn();
  const pack: ThreeAssetPack = {
    create() {
      expect(this).toBe(pack);
      return {
        node: new Group(),
        seek() {},
        setEmissiveEnabled() {},
        dispose() {},
      };
    },
    clipDuration(id) {
      expect(this).toBe(pack);
      return durationMs(id.startsWith('Defeat') ? 500 : 100);
    },
    clipNames: () => [],
    rootPolicy: () => policy,
    dispose,
  };
  const controller = new AbortController();
  const input = {
    motions: [{ asset, rootPolicy: policy }],
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
    signal: controller.signal,
    loadVisuals: vi.fn(async () => pack),
  };
  return { input, pack, dispose, controller, asset, policy };
}

test('assembles copied structural data and transfers idempotent pack ownership', async () => {
  const { input, pack, dispose, asset } = inputs();
  const result = await prepareGameAssetBundle(input);
  expect(result.motions).toEqual([asset]);
  expect(result.motions[0]).not.toBe(asset);
  expect(Object.isFrozen(result.motions[0])).toBe(true);
  expect(result.animator.locomotionClips).toEqual(input.locomotionClips);
  expect(result.animator.create('white').node).toBeInstanceOf(Group);
  expect(result.animator.clipDuration(clipId('Idle'))).toBe(100);
  expect(dispose).not.toHaveBeenCalled();
  result.animator.dispose();
  result.animator.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(pack).toBeDefined();
});

test('captures metadata and locomotion before asynchronous visual loading', async () => {
  const { input, asset } = inputs();
  const pending = prepareGameAssetBundle(input);
  asset.definition.durationMs = 999;
  input.locomotionClips.idle = clipId('Changed');
  input.motions.length = 0;
  const result = await pending;
  expect(result.motions[0]?.definition.durationMs).toBe(100);
  expect(result.animator.locomotionClips.idle).toBe('Idle');
  expect(Object.isFrozen(asset)).toBe(false);
  result.animator.dispose();
});

test.each(['empty', 'duplicate', 'identity', 'envelope'] as const)(
  'rejects %s metadata before visual allocation',
  async (kind) => {
    const { input } = inputs();
    const row = input.motions[0];
    if (!row) throw new Error('Missing test row');
    if (kind === 'empty') input.motions.length = 0;
    if (kind === 'duplicate') input.motions.push(row);
    if (kind === 'identity')
      row.rootPolicy = {
        ...row.rootPolicy,
        clipId: clipId('Other'),
      };
    if (kind === 'envelope') Object.assign(row.asset, { acceptance: null });
    await expect(prepareGameAssetBundle(input)).rejects.toThrow();
    expect(input.loadVisuals).not.toHaveBeenCalled();
  },
);

test.each(['root', 'attack', 'locomotion', 'death'] as const)(
  'disposes after %s compatibility failure',
  async (kind) => {
    const { input, pack, dispose } = inputs();
    if (kind === 'root') pack.rootPolicy = () => undefined;
    else
      pack.clipDuration = (id) =>
        kind === 'attack' && id === 'TestAttack'
          ? durationMs(101)
          : kind === 'locomotion' && id === 'Walk'
            ? undefined
            : kind === 'death' && id === 'DefeatKick'
              ? durationMs(499)
              : durationMs(id.startsWith('Defeat') ? 500 : 100);
    await expect(prepareGameAssetBundle(input)).rejects.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  },
);

test('already-aborted work never calls the visual loader', async () => {
  const { input, controller } = inputs();
  controller.abort();
  await expect(prepareGameAssetBundle(input)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(input.loadVisuals).not.toHaveBeenCalled();
});

test('late visual result after abort is disposed', async () => {
  const { input, controller, dispose } = inputs();
  const pending = prepareGameAssetBundle(input);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('loader rejection including undefined retains exact error identity', async () => {
  const { input, dispose } = inputs();
  input.loadVisuals = vi.fn(async () => {
    throw undefined;
  });
  await expect(prepareGameAssetBundle(input)).rejects.toBeUndefined();
  expect(dispose).not.toHaveBeenCalled();
});

test('cleanup failure cannot replace compatibility failure', async () => {
  const { input, pack, dispose } = inputs();
  pack.rootPolicy = () => undefined;
  dispose.mockImplementation(() => {
    throw new Error('cleanup');
  });
  await expect(prepareGameAssetBundle(input)).rejects.toThrow(
    'Incompatible visual/baked root policy',
  );
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('forwards optional capability descriptors and binds stageActor to the pack', async () => {
  const { input, pack } = inputs();
  const stage = {
    materialize() {
      throw new Error('unused');
    },
    dispose() {},
    poseFrame: {},
  };
  Object.assign(pack, {
    poseBindings: Object.freeze({ marker: 'pose' }),
    recoveryCapability: Object.freeze({ marker: 'recovery' }),
    startupCapability: Object.freeze({ marker: 'startup' }),
    stageActor() {
      expect(this).toBe(pack);
      return stage;
    },
  });
  const result = await prepareGameAssetBundle(input);
  expect(result.animator.poseBindings).toBe(pack.poseBindings);
  expect(result.animator.recoveryCapability).toBe(pack.recoveryCapability);
  expect(result.animator.startupCapability).toBe(pack.startupCapability);
  expect(result.animator.stageActor?.('white')).toBe(stage);
  result.animator.dispose();
});

test('does not invent missing optional capabilities', async () => {
  const { input } = inputs();
  const result = await prepareGameAssetBundle(input);
  for (const key of [
    'poseBindings',
    'recoveryCapability',
    'startupCapability',
    'stageActor',
  ])
    expect(Object.hasOwn(result.animator, key)).toBe(false);
  result.animator.dispose();
});

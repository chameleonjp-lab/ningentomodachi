import { expect, test } from 'vitest';
import {
  createActorAnimator,
  type ActorRig,
  type AnimatorAssets,
} from '../../src/assets/actorAnimator';
import {
  activeRealTimeMs,
  actorId,
  clipId,
  durationMs,
  gameTimeMs,
  presentationTimeMs,
  runId,
  tick,
  createLivingPoseStamp,
  type ActorColor,
  type ActorId,
  type AnimationModuleContext,
  type AnimationPort,
  type CommittedFrame,
  type DurationMs,
  type LivingPoseStamp,
  type PoseCatalogBindings,
  type PoseClipBinding,
  type StampedDefeatSeek,
} from '../../src/contracts';

const run = runId('animation-run');
const player = actorId('white');
function frame(time = 0): CommittedFrame {
  const allowed = { allowed: true as const, reason: null };
  return {
    snapshot: {
      revision: 1,
      contractVersion: 1,
      runId: run,
      phase: 'running',
      clocks: {
        tick: tick(0),
        gameTimeMs: gameTimeMs(time),
        activeRealTimeMs: activeRealTimeMs(time),
        presentationTimeMs: presentationTimeMs(time),
      },
      seed: 1,
      pauseReasons: [],
      quality: 'standard',
      actors: [
        {
          actorId: player,
          color: 'white',
          hp: 500,
          maxHp: 500,
          heat: { amount: 0, capacity: 7, lockedUntil: null },
          attack: null,
          defeated: false,
          actions: {
            punch: allowed,
            kick: allowed,
            jump: allowed,
            move: allowed,
          },
        },
      ],
      currentOpponentId: null,
      result: null,
      presentation: { kind: 'none' },
      world: { vehicles: [], objects: [] },
    },
    spatial: {
      runId: run,
      tick: tick(0),
      actors: [
        {
          actorId: player,
          position: { x: 0, y: 0, z: 3 },
          facing: { x: 0, y: 0, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          locomotion: 'idle',
        },
      ],
      vehicles: [],
    },
    events: [],
    viewport: {
      revision: 1,
      widthCssPx: 800,
      heightCssPx: 600,
      offsetLeftCssPx: 0,
      offsetTopCssPx: 0,
      devicePixelRatio: 1,
      safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
}

const black = actorId('black');
const blue = actorId('blue');
const names = ['Idle', 'Walk', 'Run', 'Jump', 'Cross'] as const;
const bindings: PoseCatalogBindings = {
  version: 1,
  bindingSetId: 'synthetic-display-control',
  clips: names.map((name) => ({
    clipId: clipId(name),
    durationMs: durationMs(1000),
    sourceBindingId: `synthetic-${name}`,
  })),
  locomotion: {
    idle: clipId('Idle'),
    walk: clipId('Walk'),
    run: clipId('Run'),
    jump: clipId('Jump'),
  },
};
function living(name = 'Idle', startedAt = 0): LivingPoseStamp {
  const binding = bindings.clips.find((value) => value.clipId === name);
  if (!binding) throw new Error('Test binding missing');
  return createLivingPoseStamp({
    version: 1,
    binding,
    mode: 'idle',
    startedAt: gameTimeMs(startedAt),
    playback: 'loop',
    activationId: null,
  });
}
function stamped(
  time: number,
  ids: readonly ActorId[] = [player],
  revision = 1,
): CommittedFrame {
  const value = frame(time);
  const actor = value.snapshot.actors[0];
  const spatial = value.spatial.actors[0];
  if (!actor || !spatial) throw new Error('Test actor missing');
  return {
    ...value,
    snapshot: {
      ...value.snapshot,
      revision,
      residentActorIds: ids,
      actors: ids.map((id) => ({
        ...actor,
        actorId: id,
        color: (id === player
          ? 'white'
          : id === black
            ? 'black'
            : 'blue') as ActorColor,
      })),
    },
    spatial: {
      ...value.spatial,
      actors: ids.map((id) => ({
        ...spatial,
        actorId: id,
        pose: { kind: 'living' as const, living: living() },
      })),
    },
  };
}
function defeated(
  presentation = 1100,
  entryAt = 1000,
  start = 0,
): CommittedFrame {
  const value = stamped(Math.max(entryAt, 1000), [player], 2);
  return {
    ...value,
    snapshot: {
      ...value.snapshot,
      clocks: {
        ...value.snapshot.clocks,
        presentationTimeMs: presentationTimeMs(presentation),
      },
      actors: value.snapshot.actors.map((actor) => ({
        ...actor,
        defeated: true,
        defeatPresentation: {
          category: 'punch' as const,
          startedAt: presentationTimeMs(1000),
          slowDurationMs: durationMs(2000),
          playbackRate: 0.25 as const,
        },
      })),
    },
    spatial: {
      ...value.spatial,
      actors: value.spatial.actors.map((actor) => ({
        ...actor,
        pose: {
          kind: 'defeat' as const,
          entry: living('Idle', start),
          entryAt: gameTimeMs(entryAt),
          defeatStartedAt: presentationTimeMs(1000),
        },
      })),
    },
  };
}
function setup() {
  const events: string[] = [];
  const poses: { binding: PoseClipBinding; time: DurationMs }[] = [];
  const deaths: StampedDefeatSeek[] = [];
  const makeRig = (color: ActorColor): ActorRig<object> => ({
    node: {},
    seek: () => {
      events.push(`${color}:legacy`);
    },
    seekPose: (binding, time) => {
      events.push(`${color}:pose`);
      poses.push({ binding, time });
    },
    seekDefeat: (input) => {
      events.push(`${color}:death`);
      deaths.push(input);
    },
    setEmissiveEnabled: (enabled) => {
      events.push(`${color}:emission:${enabled}`);
    },
    dispose: () => {
      events.push(`${color}:dispose`);
    },
  });
  const assets: AnimatorAssets<object> = {
    poseBindings: bindings,
    locomotionClips: bindings.locomotion,
    clipDuration: (id) => durationMs(id.startsWith('Defeat') ? 500 : 1000),
    create: (color) => {
      events.push(`${color}:create`);
      return makeRig(color);
    },
  };
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    posePolicy: { version: 1, mode: 'deterministic-pose-v1' },
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: ({ actorId: id }) => {
        events.push(`${id}:mount`);
        return () => {
          events.push(`${id}:detach`);
        };
      },
    },
  };
  return { events, poses, deaths, assets, context, makeRig };
}
test('qualified constructor captures real descriptors without allocating probe rigs', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  expect(animator.poseProtocol).toEqual({
    version: 1,
    protocol: 'deterministic-pose-v1',
  });
  expect(h.events).toEqual([]);
  animator.dispose();
  const { poseBindings: _removed, ...missing } = h.assets;
  expect(() => createActorAnimator(h.context, missing)).toThrow();
  expect(h.events).toEqual([]);
});
test('first display uses the C source epoch, not render-local time, and captures policy', () => {
  const h = setup();
  const policy: { version: 1; mode: 'legacy' | 'deterministic-pose-v1' } = {
    version: 1,
    mode: 'deterministic-pose-v1',
  };
  const animator = createActorAnimator(
    { ...h.context, posePolicy: policy },
    h.assets,
  );
  policy.mode = 'legacy';
  animator.render(stamped(250));
  animator.render(stamped(750));
  animator.render(stamped(250));
  expect(h.poses.map((p) => p.time)).toEqual([250, 750, 250]);
  expect(h.events.some((e) => e.endsWith(':legacy'))).toBe(false);
  animator.dispose();
});
test('delayed first defeat reconstructs the exact LEFT loop seam and supports reverse/repeated display', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  animator.render(defeated(1500));
  animator.render(defeated(1100));
  animator.render(defeated(1100));
  expect(h.deaths.map((d) => d.deathClipTime)).toEqual([125, 25, 25]);
  expect(
    h.deaths.every(
      (d) =>
        !('kind' in d.entry) &&
        d.entry.clipTime === 1000 &&
        d.entry.sampleSide === 'left',
    ),
  ).toBe(true);
  expect(h.poses).toHaveLength(0);
  expect(h.events.filter((e) => e === 'white:create')).toHaveLength(1);
  animator.dispose();
});
test('all resident stamps preflight before any seek, retirement or frontier mutation', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  animator.render(stamped(0, [player, black]));
  const before = [...h.events];
  const next = stamped(100, [player, blue], 2);
  const bad = {
    ...next,
    spatial: {
      ...next.spatial,
      actors: next.spatial.actors.map((p) =>
        p.actorId === blue
          ? {
              ...p,
              pose: {
                kind: 'living' as const,
                living: {
                  ...living(),
                  binding: { ...living().binding, sourceBindingId: 'wrong' },
                },
              },
            }
          : p,
      ),
    },
  };
  expect(() => animator.render(bad)).toThrow();
  expect(h.events).toEqual(before);
  animator.render(stamped(50, [player, black]));
  expect(h.events).not.toContain('black:dispose');
  animator.dispose();
});
test('full immutable defeat provenance rejects same local time from a different epoch before mutation', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  animator.render(stamped(0));
  animator.render(defeated());
  const before = [...h.events];
  expect(() => animator.render(defeated(2100, 2000, 1000))).toThrow();
  expect(h.events).toEqual(before);
  animator.render(stamped(500));
  animator.render(defeated());
  expect(h.deaths).toHaveLength(2);
  animator.dispose();
});
test('qualified mode rejects missing spatial stamps and mismatched committed ticks', () => {
  for (const missing of [true, false]) {
    const h = setup();
    const animator = createActorAnimator(h.context, h.assets);
    const f = stamped(10);
    const bad = missing
      ? {
          ...f,
          spatial: {
            ...f.spatial,
            actors: f.spatial.actors.map(({ pose: _pose, ...p }) => p),
          },
        }
      : { ...f, spatial: { ...f.spatial, tick: tick(99) } };
    expect(() => animator.render(bad)).toThrow();
    expect(h.events).toEqual([]);
    animator.dispose();
  }
});
test('new rig method failure is fail-closed after authoritative retirement and cleans the untransferred acquisition', () => {
  const h = setup();
  const original = h.assets.create.bind(h.assets);
  let fail = true;
  const assets = {
    ...h.assets,
    create: (color: ActorColor) => {
      const rig = original(color);
      if (color === 'blue' && fail)
        Object.defineProperty(rig, 'seekPose', {
          get() {
            throw new Error('method getter');
          },
        });
      return rig;
    },
  };
  const animator = createActorAnimator(h.context, assets);
  animator.render(stamped(0, [player, black]));
  const before = h.poses.length;
  expect(() => animator.render(stamped(10, [player, blue], 2))).toThrow(
    'method getter',
  );
  expect(h.poses).toHaveLength(before);
  expect(h.events.filter((e) => e === 'black:dispose')).toHaveLength(1);
  expect(h.events.indexOf('black:dispose')).toBeLessThan(
    h.events.indexOf('blue:create'),
  );
  expect(h.events.filter((e) => e === 'blue:dispose')).toHaveLength(1);
  expect(() => animator.render(stamped(5, [player, black]))).toThrow('Retired');
  fail = false;
  animator.render(stamped(10, [player, blue], 2));
  animator.dispose();
});
for (const trigger of ['create', 'method', 'mount'] as const)
  test(`reentrant disposal during ${trigger} cannot remount or resurrect an acquired rig`, () => {
    const h = setup();
    let animator: AnimationPort;
    const create = h.assets.create.bind(h.assets);
    const mount = h.context.renderHost.mountActor.bind(h.context.renderHost);
    const assets = {
      ...h.assets,
      create: (color: ActorColor) => {
        const rig = create(color);
        if (trigger === 'create') animator.dispose();
        if (trigger === 'method')
          Object.defineProperty(rig, 'seekPose', {
            get() {
              animator.dispose();
              return () => {};
            },
          });
        return rig;
      },
    };
    const context = {
      ...h.context,
      renderHost: {
        ...h.context.renderHost,
        mountActor: (input: Parameters<typeof mount>[0]) => {
          const detach = mount(input);
          if (trigger === 'mount') animator.dispose();
          return detach;
        },
      },
    };
    animator = createActorAnimator(context, assets);
    expect(() => animator.render(stamped(0))).toThrow();
    expect(h.events.filter((e) => e === 'white:dispose')).toHaveLength(1);
    expect(h.poses).toHaveLength(0);
    expect(h.deaths).toHaveLength(0);
    expect(h.events.filter((e) => e === 'white:detach')).toHaveLength(
      trigger === 'mount' ? 1 : 0,
    );
    if (trigger === 'mount')
      expect(h.events.indexOf('white:detach')).toBeLessThan(
        h.events.indexOf('white:dispose'),
      );
    const before = [...h.events];
    animator.render(stamped(10));
    animator.dispose();
    expect(h.events).toEqual(before);
  });
test('retirement is final, but historical replay within the resident lifetime remains available', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  animator.render(stamped(0, [player, black]));
  animator.render(stamped(10, [player], 2));
  expect(h.events.filter((e) => e === 'black:dispose')).toHaveLength(1);
  expect(() => animator.render(stamped(0, [player, black]))).toThrow('Retired');
  animator.render(stamped(0, [player], 2));
  animator.dispose();
});

test('render cadence and skipped same-clip activations do not establish a second clock', () => {
  for (const hz of [0, 30, 60, 120]) {
    const h = setup();
    const animator = createActorAnimator(h.context, h.assets);
    if (hz)
      for (let t = 0; t < 650; t += 1000 / hz) animator.render(stamped(t));
    const f = stamped(650);
    animator.render({
      ...f,
      spatial: {
        ...f.spatial,
        actors: f.spatial.actors.map((p) => ({
          ...p,
          pose: { kind: 'living', living: living('Idle', 500) },
        })),
      },
    });
    expect(h.poses.at(-1)?.time).toBe(150);
    animator.dispose();
  }
});
test('source descriptor and rig methods are captured once, with their receivers', () => {
  const h = setup();
  const supplied = { ...bindings, clips: [...bindings.clips] };
  let gets = 0;
  const assets = {
    ...h.assets,
    poseBindings: supplied,
    create: (color: ActorColor) => {
      const rig = h.makeRig(color);
      const seek = rig.seekPose;
      Object.defineProperty(rig, 'seekPose', {
        get() {
          gets++;
          return function (
            this: ActorRig<object>,
            binding: PoseClipBinding,
            time: DurationMs,
          ) {
            expect(this).toBe(rig);
            seek?.(binding, time);
          };
        },
      });
      return rig;
    },
  };
  const animator = createActorAnimator(h.context, assets);
  supplied.clips.length = 0;
  animator.render(stamped(100));
  animator.render(stamped(200));
  expect(gets).toBe(1);
  expect(h.poses.map((p) => p.time)).toEqual([100, 200]);
  animator.dispose();
});
test('qualified descriptor duration/death/locomotion mismatch rejects without any create', () => {
  for (const assets of [
    { ...setup().assets, clipDuration: () => durationMs(999) },
    {
      ...setup().assets,
      clipDuration: (id: ReturnType<typeof clipId>) =>
        durationMs(
          id === 'DefeatKick' ? 501 : id === 'DefeatPunch' ? 500 : 1000,
        ),
    },
    {
      ...setup().assets,
      locomotionClips: { ...bindings.locomotion, idle: clipId('Walk') },
    },
  ]) {
    const h = setup();
    let creates = 0;
    expect(() =>
      createActorAnimator(h.context, {
        ...assets,
        create: () => {
          creates++;
          return h.makeRig('white');
        },
      }),
    ).toThrow();
    expect(creates).toBe(0);
  }
});
test('future epochs, wrong death identities and absent LEFT entry reject before first acquisition', () => {
  const f = stamped(100);
  const d = defeated();
  const cases: CommittedFrame[] = [
    {
      ...f,
      spatial: {
        ...f.spatial,
        actors: f.spatial.actors.map((p) => ({
          ...p,
          pose: { kind: 'living', living: living('Idle', 101) },
        })),
      },
    },
    {
      ...d,
      spatial: {
        ...d.spatial,
        actors: d.spatial.actors.map((p) => ({
          ...p,
          pose: {
            kind: 'defeat',
            entry: living(),
            entryAt: gameTimeMs(1000),
            defeatStartedAt: presentationTimeMs(999),
          },
        })),
      },
    },
    {
      ...d,
      spatial: {
        ...d.spatial,
        actors: d.spatial.actors.map((p) => ({
          ...p,
          pose: {
            kind: 'defeat',
            entry: living('Idle', 1000),
            entryAt: gameTimeMs(1000),
            defeatStartedAt: presentationTimeMs(1000),
          },
        })),
      },
    },
  ];
  for (const bad of cases) {
    const h = setup();
    const animator = createActorAnimator(h.context, h.assets);
    expect(() => animator.render(bad)).toThrow();
    expect(h.events).toEqual([]);
    animator.dispose();
  }
});
test('missing actual methods cannot advertise driver readiness by descriptor alone', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, {
    ...h.assets,
    create: (color) => {
      const { seekDefeat: _method, ...rig } = h.makeRig(color);
      return rig;
    },
  });
  expect(() => animator.render(stamped(0))).toThrow(
    'deterministic pose methods',
  );
  expect(h.events).toEqual(['white:dispose']);
  animator.dispose();
});
test('a later mount failure releases every pending rig but does not retire or seek current residents', () => {
  const h = setup();
  let fail = false;
  const mount = h.context.renderHost.mountActor.bind(h.context.renderHost);
  const context = {
    ...h.context,
    renderHost: {
      ...h.context.renderHost,
      mountActor: (input: Parameters<typeof mount>[0]) => {
        if (fail && input.actorId === blue) throw new Error('late mount');
        return mount(input);
      },
    },
  };
  const animator = createActorAnimator(context, h.assets);
  animator.render(stamped(0));
  const count = h.poses.length;
  fail = true;
  expect(() => animator.render(stamped(10, [player, black, blue], 2))).toThrow(
    'late mount',
  );
  expect(h.poses).toHaveLength(count);
  expect(h.events.filter((e) => e === 'black:detach')).toHaveLength(1);
  expect(h.events.filter((e) => e === 'black:dispose')).toHaveLength(1);
  expect(h.events.filter((e) => e === 'blue:dispose')).toHaveLength(1);
  expect(h.events).not.toContain('white:dispose');
  expect(() => animator.render(stamped(5))).toThrow('Stale');
  fail = false;
  animator.render(stamped(10, [player, black, blue], 2));
  animator.dispose();
});
test('qualified residency rejects null, downgrade and same-revision changes without mutating resources', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  animator.render(stamped(0));
  const before = [...h.events];
  const f = stamped(20);
  const { residentActorIds: _ids, ...legacy } = f.snapshot;
  for (const candidate of [
    { ...f, snapshot: { ...f.snapshot, residentActorIds: null } },
    { ...f, snapshot: legacy },
    stamped(20, [player, black]),
  ]) {
    // Deliberate boundary corruption, not an internal substitute DTO.
    expect(() => animator.render(candidate as CommittedFrame)).toThrow();
    expect(h.events).toEqual(before);
  }
  animator.dispose();
});
test('support is published after atomic death seek with complete frame identity and fixed mount capability', () => {
  const h = setup();
  const seen: import('../../src/contracts').DefeatPoseSupportObservation[] = [];
  const context: AnimationModuleContext<object> = {
    ...h.context,
    renderHost: {
      ...h.context.renderHost,
      mountActor: (input) => {
        expect(input.defeatPoseSupport).toBe('bounds-v1');
        return () => {
          h.events.push('detach');
        };
      },
      publishDefeatPoseSupport: (observation) => {
        expect(h.deaths).toHaveLength(seen.length + 1);
        seen.push(observation);
        return true;
      },
    },
  };
  const animator = createActorAnimator(context, {
    ...h.assets,
    create: (color) => ({
      ...h.makeRig(color),
      defeatPoseSupport: () => ({
        entryLocalMinY: -0.5,
        currentLocalBounds: {
          min: { x: -1, y: 0, z: -1 },
          max: { x: 1, y: 2, z: 1 },
        },
      }),
    }),
  });
  animator.render(defeated(1500));
  animator.render(defeated(1100));
  expect(seen.map((s) => s.entryLocalMinY)).toEqual([-0.5, -0.5]);
  expect(seen.map((s) => s.presentationTimeMs)).toEqual([1500, 1100]);
  expect(
    seen.every(
      (s) =>
        s.runId === run &&
        s.actorId === player &&
        s.defeatStartedAt === 1000 &&
        s.tick === 0,
    ),
  ).toBe(true);
  animator.dispose();
});
for (const unavailable of [false, true])
  test(`qualified support ${unavailable ? 'absence' : 'publication rejection'} never silently downgrades`, () => {
    const h = setup();
    const context: AnimationModuleContext<object> = {
      ...h.context,
      renderHost: {
        ...h.context.renderHost,
        publishDefeatPoseSupport: () => false,
      },
    };
    const animator = createActorAnimator(context, {
      ...h.assets,
      create: (color) => ({
        ...h.makeRig(color),
        defeatPoseSupport: () =>
          unavailable
            ? undefined
            : {
                entryLocalMinY: 0,
                currentLocalBounds: {
                  min: { x: 0, y: 0, z: 0 },
                  max: { x: 1, y: 1, z: 1 },
                },
              },
      }),
    });
    expect(() => animator.render(defeated())).toThrow(
      unavailable ? 'Unavailable' : 'rejected',
    );
    expect(h.events).not.toContain('white:legacy');
    animator.dispose();
  });

test('actual pinned public factory reconstructs skipped attack-to-death entry and matching support without a probe rig', async () => {
  const { readFileSync } = await import('node:fs');
  const { Object3D } = await import('three');
  const { attackActivationId } = await import('../../src/contracts');
  const {
    createPinnedDerivedThreeAssetPack,
    ANDROID_DERIVED_PACK_V1,
    ANDROID_RUNTIME_ARTIFACT_V1,
  } = await import('../../src/assets');
  const pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: new Uint8Array(
      readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
    ),
    artifactBytes: new Uint8Array(
      readFileSync(`public${ANDROID_RUNTIME_ARTIFACT_V1.url}`),
    ),
    signal: new AbortController().signal,
  });
  const descriptor = pack.poseBindings;
  if (!descriptor) throw new Error('Pinned descriptor missing');
  const binding = descriptor.clips.find((b) => b.clipId === 'CartwheelKick');
  if (!binding) throw new Error('Pinned source binding missing');
  const entry = createLivingPoseStamp({
    version: 1,
    binding,
    mode: 'attack',
    startedAt: gameTimeMs(0),
    playback: 'clamp',
    activationId: attackActivationId('source-entry'),
  });
  const parent = new Object3D();
  parent.position.set(7, 2, -3);
  parent.rotation.y = 0.7;
  parent.updateMatrixWorld(true);
  const initialParent = parent.matrixWorld.toArray();
  const reference = pack.create('white');
  parent.add(reference.node);
  let mounted: InstanceType<typeof Object3D> | undefined;
  let creates = 0;
  let support:
    | import('../../src/contracts').DefeatPoseSupportObservation
    | undefined;
  const h = setup();
  const context: AnimationModuleContext<InstanceType<typeof Object3D>> = {
    ...h.context,
    renderHost: {
      runId: run,
      mountActor: (input) => {
        expect(input.defeatPoseSupport).toBe('bounds-v1');
        mounted = input.node;
        parent.add(input.node);
        parent.updateMatrixWorld(true);
        return () => {
          parent.remove(input.node);
        };
      },
      publishDefeatPoseSupport: (value) => {
        support = value;
        return true;
      },
    },
  };
  const animator = createActorAnimator(context, {
    ...pack,
    locomotionClips: descriptor.locomotion,
    create: (color) => {
      creates++;
      return pack.create(color);
    },
  });
  try {
    expect(creates).toBe(0);
    for (const shownAt of [1500, 1100, 1100, 3000]) {
      const f = defeated(shownAt, 900);
      const current = {
        ...f,
        spatial: {
          ...f.spatial,
          actors: f.spatial.actors.map((p) => ({
            ...p,
            pose: {
              kind: 'defeat' as const,
              entry,
              entryAt: gameTimeMs(900),
              defeatStartedAt: presentationTimeMs(1000),
            },
          })),
        },
      };
      animator.render(current);
      if (!mounted || !reference.seekDefeat || !reference.defeatPoseSupport)
        throw new Error('Actual qualified rig absent');
      reference.seekDefeat({
        runId: run,
        actorId: player,
        defeatStartedAt: presentationTimeMs(1000),
        deathClipId: clipId('DefeatPunch'),
        deathClipTime: durationMs(Math.min(500, (shownAt - 1000) * 0.25)),
        entry: { binding, clipTime: durationMs(900), sampleSide: 'left' },
      });
      const a: number[] = [],
        b: number[] = [];
      mounted.traverse((node) => a.push(...node.matrixWorld.elements));
      reference.node.traverse((node) => b.push(...node.matrixWorld.elements));
      expect(a.length).toBe(b.length);
      expect(
        Math.max(
          ...a.map((value, index) => Math.abs(value - (b[index] ?? Infinity))),
        ),
      ).toBeLessThan(1e-10);
      const expected = reference.defeatPoseSupport();
      expect(expected).toBeDefined();
      expect(support?.entryLocalMinY).toBe(expected?.entryLocalMinY);
      expect(support?.currentLocalBounds).toEqual(expected?.currentLocalBounds);
      expect(parent.matrixWorld.toArray()).toEqual(initialParent);
    }
    expect(creates).toBe(1);
  } finally {
    animator.dispose();
    parent.remove(reference.node);
    reference.dispose();
    pack.dispose();
  }
}, 30000);

for (const property of [
  'node',
  'seekPose',
  'seekDefeat',
  'defeatPoseSupport',
  'setEmissiveEnabled',
] as const)
  test(`reentrant ${property} getter cannot continue acquisition after disposal`, () => {
    const h = setup();
    let animator: AnimationPort;
    const assets = {
      ...h.assets,
      create: (color: ActorColor) => {
        const rig = h.makeRig(color),
          value = rig[property];
        Object.defineProperty(rig, property, {
          get() {
            animator.dispose();
            return value;
          },
        });
        return rig;
      },
    };
    animator = createActorAnimator(h.context, assets);
    expect(() => animator.render(stamped(0))).toThrow('disposed');
    expect(h.events).toEqual(['white:dispose']);
    animator.dispose();
    expect(h.events).toEqual(['white:dispose']);
  });
test('a publication callback disposing the run stops the remaining actor and never revives entries', () => {
  const h = setup();
  let animator: AnimationPort;
  const context: AnimationModuleContext<object> = {
    ...h.context,
    renderHost: {
      ...h.context.renderHost,
      publishDefeatPoseSupport: () => {
        animator.dispose();
        return true;
      },
    },
  };
  animator = createActorAnimator(context, {
    ...h.assets,
    create: (color) => ({
      ...h.makeRig(color),
      defeatPoseSupport: () => ({
        entryLocalMinY: 0,
        currentLocalBounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        },
      }),
    }),
  });
  const d = defeated();
  const s = stamped(1000, [player, black], 2);
  const victim = d.snapshot.actors[0],
    pose = d.spatial.actors[0];
  if (!victim || !pose) throw new Error('Fixture');
  const both = {
    ...s,
    snapshot: {
      ...s.snapshot,
      clocks: d.snapshot.clocks,
      actors: s.snapshot.actors.map((a) => ({
        ...victim,
        actorId: a.actorId,
        color: a.color,
      })),
    },
    spatial: {
      ...s.spatial,
      actors: s.spatial.actors.map((a) => ({ ...pose, actorId: a.actorId })),
    },
  };
  expect(() => animator.render(both)).toThrow('disposed');
  expect(h.deaths).toHaveLength(1);
  expect(h.events.filter((e) => e.endsWith(':dispose'))).toHaveLength(2);
  expect(h.events.some((e) => e.includes(':emission:'))).toBe(false);
  const count = h.events.length;
  animator.render(both);
  animator.dispose();
  expect(h.events).toHaveLength(count);
});
test('second resident defeat provenance conflict cannot seek the first resident', () => {
  const h = setup();
  const animator = createActorAnimator(h.context, h.assets);
  const d = defeated();
  const s = stamped(1000, [player, black], 2);
  const victim = d.snapshot.actors[0],
    pose = d.spatial.actors[0];
  if (!victim || !pose) throw new Error('Fixture');
  const both = {
    ...s,
    snapshot: {
      ...s.snapshot,
      clocks: d.snapshot.clocks,
      actors: s.snapshot.actors.map((a) => ({
        ...victim,
        actorId: a.actorId,
        color: a.color,
      })),
    },
    spatial: {
      ...s.spatial,
      actors: s.spatial.actors.map((a) => ({ ...pose, actorId: a.actorId })),
    },
  };
  animator.render(both);
  const before = [...h.events];
  const bad = {
    ...both,
    snapshot: {
      ...both.snapshot,
      clocks: { ...both.snapshot.clocks, gameTimeMs: gameTimeMs(2000) },
    },
    spatial: {
      ...both.spatial,
      actors: both.spatial.actors.map((p) =>
        p.actorId === black
          ? {
              ...p,
              pose: {
                kind: 'defeat' as const,
                entry: living('Idle', 1000),
                entryAt: gameTimeMs(2000),
                defeatStartedAt: presentationTimeMs(1000),
              },
            }
          : p,
      ),
    },
  };
  expect(() => animator.render(bad)).toThrow('provenance');
  expect(h.events).toEqual(before);
  animator.dispose();
});

test('qualified retirement releases the old actor before replacement creation with at most two owned rigs', () => {
  const h = setup();
  let owned = 0,
    peak = 0;
  const create = h.assets.create.bind(h.assets);
  const animator = createActorAnimator(h.context, {
    ...h.assets,
    create: (color) => {
      owned++;
      peak = Math.max(peak, owned);
      const rig = create(color);
      return {
        ...rig,
        dispose: () => {
          owned--;
          rig.dispose();
        },
      };
    },
  });
  try {
    animator.render(stamped(0, [player, black]));
    animator.render(stamped(10, [player, blue], 2));
    expect(h.events.indexOf('black:detach')).toBeLessThan(
      h.events.indexOf('black:dispose'),
    );
    expect(h.events.indexOf('black:dispose')).toBeLessThan(
      h.events.indexOf('blue:create'),
    );
    expect(peak).toBe(2);
    expect(owned).toBe(2);
  } finally {
    animator.dispose();
  }
  expect(owned).toBe(0);
});

for (const field of [
  'entry',
  'bounds',
  'min',
  'max',
  'minX',
  'minY',
  'minZ',
  'maxX',
  'maxY',
  'maxZ',
] as const) {
  test(`support ${field} getter disposal cannot publish or continue presentation`, () => {
    const h = setup();
    let animator: AnimationPort;
    let publications = 0;
    const support = {
      entryLocalMinY: 0,
      currentLocalBounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      },
    };
    const bounds = support.currentLocalBounds;
    const cases: Record<typeof field, readonly [object, string, unknown]> = {
      entry: [support, 'entryLocalMinY', 0],
      bounds: [support, 'currentLocalBounds', bounds],
      min: [bounds, 'min', bounds.min],
      max: [bounds, 'max', bounds.max],
      minX: [bounds.min, 'x', 0],
      minY: [bounds.min, 'y', 0],
      minZ: [bounds.min, 'z', 0],
      maxX: [bounds.max, 'x', 1],
      maxY: [bounds.max, 'y', 1],
      maxZ: [bounds.max, 'z', 1],
    };
    const [target, key, value] = cases[field];
    Object.defineProperty(target, key, {
      enumerable: true,
      get: () => {
        animator.dispose();
        return value;
      },
    });
    animator = createActorAnimator(
      {
        ...h.context,
        renderHost: {
          ...h.context.renderHost,
          publishDefeatPoseSupport: (observation) => {
            publications++;
            // A real consumer reads the complete nested bounds, not just the
            // observation's top-level properties.
            const b = observation.currentLocalBounds;
            const scalars = [
              observation.entryLocalMinY,
              b.min.x,
              b.min.y,
              b.min.z,
              b.max.x,
              b.max.y,
              b.max.z,
            ];
            return scalars.every(Number.isFinite);
          },
        },
      },
      {
        ...h.assets,
        create: (color) => ({
          ...h.makeRig(color),
          defeatPoseSupport: () => support,
        }),
      },
    );
    expect(() => animator.render(defeated())).toThrow('disposed');
    expect(publications).toBe(0);
    expect(h.events.filter((event) => event === 'white:dispose')).toHaveLength(
      1,
    );
    expect(h.events.indexOf('white:detach')).toBeLessThan(
      h.events.indexOf('white:dispose'),
    );
    expect(h.events.some((event) => event.includes(':emission:'))).toBe(false);
    const events = [...h.events];
    animator.render(defeated());
    animator.dispose();
    expect(h.events).toEqual(events);
  });
}

for (const action of ['dispose', 'throw'] as const) {
  test(`support coordinate ${action} stops later getter reads and retains the original error`, () => {
    const h = setup();
    let animator: AnimationPort;
    let laterReads = 0;
    let publications = 0;
    const failure = new Error('support coordinate sentinel');
    const support = {
      entryLocalMinY: 0,
      currentLocalBounds: {
        min: {
          get x() {
            if (action === 'throw') throw failure;
            animator.dispose();
            return 0;
          },
          get y() {
            laterReads++;
            return 0;
          },
          z: 0,
        },
        max: { x: 1, y: 1, z: 1 },
      },
    };
    animator = createActorAnimator(
      {
        ...h.context,
        renderHost: {
          ...h.context.renderHost,
          publishDefeatPoseSupport: () => {
            publications++;
            return true;
          },
        },
      },
      {
        ...h.assets,
        create: (color) => ({
          ...h.makeRig(color),
          defeatPoseSupport: () => support,
        }),
      },
    );
    let caught: unknown;
    try {
      animator.render(defeated());
    } catch (error) {
      caught = error;
    }
    if (action === 'throw') expect(caught).toBe(failure);
    else expect(String(caught)).toContain('disposed');
    expect(laterReads).toBe(0);
    expect(publications).toBe(0);
    expect(h.events.some((event) => event.includes(':emission:'))).toBe(false);
    animator.dispose();
    expect(h.events.filter((event) => event === 'white:dispose')).toHaveLength(
      1,
    );
    expect(h.events.indexOf('white:detach')).toBeLessThan(
      h.events.indexOf('white:dispose'),
    );
  });
}

import {
  createPoseFrameDriver,
  RECOVERY_FRAME_CAPABILITY,
  STARTUP_FRAME_CAPABILITY,
  type PoseFrameRequest,
} from '../../src/assets/poseFramePreparation';
function recoverySetup(fail?: ActorColor, startup = false, overflow = false) {
  const h = setup(),
    requests: PoseFrameRequest[] = [];
  const context = {
    ...h.context,
    posePolicy: {
      version: 1 as const,
      mode: 'deterministic-pose-v1' as const,
      recovery: RECOVERY_FRAME_CAPABILITY,
    },
  };
  const stageActor = (color: ActorColor) => {
    const driver = createPoseFrameDriver(
      (request) => {
        requests.push(request);
        h.events.push(`${color}:prepare`);
        if (color === fail && !startup && !overflow)
          throw Error('late invalid pose');
        return {
          ...(color === fail && overflow
            ? {
                basisLayer: [
                  Math.SQRT1_2,
                  0,
                  -Math.SQRT1_2,
                  0,
                  0,
                  1,
                  0,
                  0,
                  Math.SQRT1_2,
                  0,
                  Math.SQRT1_2,
                  0,
                  0,
                  0,
                  0,
                  1,
                ],
              }
            : {}),
          ...(color === fail && startup
            ? { basisLayer: [1, 0, 0, 0.2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
            : {}),
          pose: [
            {
              id: 'root',
              parent: null,
              t: color === fail && overflow ? [1.5e308, 0, 1.5e308] : [0, 0, 0],
              q: [0, 0, 0, 1],
              s: [1, 1, 1],
            },
          ],
        };
      },
      () => h.events.push(`${color}:apply`),
      () => {},
      startup ? STARTUP_FRAME_CAPABILITY : undefined,
    );
    let consumed = false,
      disposed = false;
    return {
      poseFrame: driver,
      materialize() {
        if (consumed || disposed) throw Error('stage consumed');
        consumed = true;
        h.events.push(`${color}:create`);
        const rig = h.makeRig(color);
        return {
          ...rig,
          poseFrame: driver,
          dispose() {
            driver.dispose();
            rig.dispose();
          },
        };
      },
      dispose() {
        if (consumed || disposed) return;
        disposed = true;
        driver.dispose();
        h.events.push(`${color}:stage-dispose`);
      },
    };
  };
  const assets = {
    ...h.assets,
    recoveryCapability: RECOVERY_FRAME_CAPABILITY,
    stageActor,
    create: (color: ActorColor) => stageActor(color).materialize(),
  };
  return { ...h, context, assets, requests };
}
test('synthetic stage2 all actor preparations precede mount emission and apply', () => {
  const h = recoverySetup(),
    a = createActorAnimator(h.context, h.assets);
  a.render(stamped(25, [player, blue]));
  const lastPrepare = h.events.lastIndexOf('blue:prepare'),
    firstMount = h.events.findIndex((e) => e.endsWith(':mount'));
  expect(lastPrepare).toBeLessThan(firstMount);
  expect(h.events.indexOf('white:apply')).toBeGreaterThan(lastPrepare);
  expect(h.requests).toHaveLength(2);
  a.dispose();
});
test('synthetic stage2 late new actor invalid pose causes zero mounts emissions or visible writes', () => {
  const h = recoverySetup('blue'),
    a = createActorAnimator(h.context, h.assets);
  expect(() => a.render(stamped(25, [player, blue]))).toThrow(
    'late invalid pose',
  );
  expect(
    h.events.filter((e) => /:mount|:emission|:apply|:pose|:death/.test(e)),
  ).toEqual([]);
  expect(h.events).toContain('white:stage-dispose');
  expect(h.events).toContain('blue:stage-dispose');
  a.dispose();
});
test('synthetic stage2 late invalid newcomer preserves existing actor without visible writes', () => {
  const h = recoverySetup('blue'),
    a = createActorAnimator(h.context, h.assets);
  a.render(stamped(0));
  h.events.length = 0;
  expect(() => a.render(stamped(25, [player, blue], 2))).toThrow(
    'late invalid pose',
  );
  expect(
    h.events.filter((e) =>
      /:mount|:emission|:apply|:pose|:death|:detach/.test(e),
    ),
  ).toEqual([]);
  expect(h.events).not.toContain('white:dispose');
  a.dispose();
});
test('synthetic stage2 v1 descriptors alone cannot negotiate recovery', () => {
  const h = recoverySetup();
  expect(() => createActorAnimator(h.context, h.assets)).not.toThrow();
  const { recoveryCapability: _cap, ...withoutCapability } = h.assets;
  expect(() => createActorAnimator(h.context, withoutCapability)).toThrow();
});
test('synthetic stage2 declared pack capability cannot substitute missing actor driver', () => {
  const h = recoverySetup(),
    a = createActorAnimator(h.context, {
      ...h.assets,
      stageActor: (color) => ({
        ...h.assets.stageActor(color),
        materialize: () => h.makeRig(color),
      }),
    });
  expect(() => a.render(stamped(0))).toThrow();
  expect(h.events.filter((e) => e.endsWith(':mount'))).toEqual([]);
  a.dispose();
});

import {
  createRecoveryPoseEpoch,
  attackActivationId,
} from '../../src/contracts';
test('synthetic stage2 composite defeat forwards C identity left time and distinct presentation epoch', () => {
  const h = recoverySetup(),
    attackBinding = {
      clipId: clipId('KungFuStraight'),
      durationMs: durationMs(1000),
      sourceBindingId: 'synthetic-KungFuStraight',
    };
  const epoch = createRecoveryPoseEpoch({
    runId: run,
    actorId: player,
    outgoing: createLivingPoseStamp({
      version: 1,
      binding: attackBinding,
      mode: 'attack',
      startedAt: gameTimeMs(0),
      playback: 'clamp',
      activationId: attackActivationId('a'),
    }),
    destination: living('Idle', 1000),
  });
  const assets = {
      ...h.assets,
      poseBindings: { ...bindings, clips: [...bindings.clips, attackBinding] },
    },
    a = createActorAnimator(h.context, assets),
    f = defeated(1100, 1075);
  a.render({
    ...f,
    spatial: {
      ...f.spatial,
      actors: f.spatial.actors.map((actor) => ({
        ...actor,
        pose: {
          kind: 'defeat' as const,
          entry: epoch,
          entryAt: gameTimeMs(1075),
          defeatStartedAt: presentationTimeMs(1000),
        },
      })),
    },
  });
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]).toMatchObject({
    kind: 'defeat',
    input: {
      defeatStartedAt: 1000,
      deathClipTime: 25,
      entry: {
        kind: 'recovery',
        epoch: { identity: epoch.identity },
        at: 1075,
        sampleSide: 'left',
      },
    },
  });
  expect(h.deaths).toHaveLength(0);
  a.dispose();
});

test('synthetic stage2 R2 public animator allows fresh historical resident replay', () => {
  const h = recoverySetup(),
    a = createActorAnimator(h.context, h.assets);
  a.render(stamped(25, [player], 2));
  a.render(stamped(0, [player], 1));
  expect(h.requests.map((r) => r.revision)).toEqual([2, 1]);
  a.dispose();
});
test('synthetic stage2 R2 replacement full rig is created only after old retirement and peak stays two', () => {
  const h = recoverySetup(),
    a = createActorAnimator(h.context, h.assets);
  a.render(stamped(0, [player, black], 1));
  a.render(stamped(25, [player, blue], 2));
  expect(h.events.indexOf('black:dispose')).toBeLessThan(
    h.events.indexOf('blue:create'),
  );
  let live = 0,
    peak = 0;
  for (const event of h.events) {
    if (event.endsWith(':create')) live++;
    if (event.endsWith(':dispose')) live--;
    peak = Math.max(peak, live);
  }
  expect(peak).toBe(2);
  a.dispose();
});
test('synthetic stage2 R2 failed replacement preparation neither retires old nor creates new full rig', () => {
  const h = recoverySetup('blue'),
    a = createActorAnimator(h.context, h.assets);
  a.render(stamped(0, [player, black], 1));
  h.events.length = 0;
  expect(() => a.render(stamped(25, [player, blue], 2))).toThrow(
    'late invalid pose',
  );
  expect(h.events).not.toContain('black:dispose');
  expect(h.events).not.toContain('blue:create');
  expect(h.events.filter((e) => /:apply|:emission|:detach/.test(e))).toEqual(
    [],
  );
  expect(h.events).toContain('blue:stage-dispose');
  a.dispose();
});

test('synthetic stage2 R2 materialization exception releases CPU handle without touching prepared existing actor', () => {
  const h = recoverySetup(),
    normal = h.assets.stageActor;
  const a = createActorAnimator(h.context, {
    ...h.assets,
    stageActor: (color) => {
      const handle = normal(color);
      return color === 'blue'
        ? {
            ...handle,
            materialize() {
              throw Error('materialization failure');
            },
          }
        : handle;
    },
  });
  a.render(stamped(0, [player, black], 1));
  h.events.length = 0;
  expect(() => a.render(stamped(25, [player, blue], 2))).toThrow(
    'materialization failure',
  );
  expect(h.events).toContain('blue:stage-dispose');
  expect(h.events).toContain('black:dispose');
  expect(h.events.filter((e) => /:apply|:emission/.test(e))).toEqual([]);
  a.dispose();
});

test.each(['getter', 'mismatch', 'reentrant', 'cleanup-throws'] as const)(
  'synthetic stage2 R3 materialized rig owned before transfer validation: %s',
  (kind) => {
    const h = recoverySetup(),
      normal = h.assets.stageActor;
    let disposed = 0,
      a: AnimationPort;
    a = createActorAnimator(h.context, {
      ...h.assets,
      stageActor: (color) => {
        const handle = normal(color);
        return {
          ...handle,
          materialize() {
            const rig = handle.materialize(),
              release = rig.dispose;
            const wrapped = {
              ...rig,
              dispose() {
                disposed++;
                release();
                if (kind === 'cleanup-throws') throw Error('cleanup failure');
              },
            };
            Object.defineProperty(wrapped, 'poseFrame', {
              get() {
                if (kind === 'getter' || kind === 'cleanup-throws')
                  throw Error('transfer getter failure');
                if (kind === 'reentrant') {
                  a.dispose();
                  return rig.poseFrame;
                }
                return createPoseFrameDriver(
                  () => ({
                    pose: [
                      {
                        id: 'root',
                        parent: null,
                        t: [0, 0, 0],
                        q: [0, 0, 0, 1],
                        s: [1, 1, 1],
                      },
                    ],
                  }),
                  () => {},
                  () => {},
                );
              },
            });
            return wrapped;
          },
        };
      },
    });
    let error: unknown;
    try {
      a.render(stamped(0));
    } catch (value) {
      error = value;
    }
    expect(error).toBeDefined();
    expect(disposed).toBe(1);
    expect(h.events.filter((e) => /:mount|:apply|:emission/.test(e))).toEqual(
      [],
    );
    if (kind === 'cleanup-throws') {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors[0]).toMatchObject({
        message: 'transfer getter failure',
      });
    }
    a.dispose();
    expect(disposed).toBe(1);
  },
);

const startupPolicy = {
  version: 1 as const,
  protocol: 'side-kick-startup-matrix-v1' as const,
  durationMs: durationMs(100),
  fixedLiftSign: 1 as const,
};
test('startup capability is required separately before any actor allocation', () => {
  const h = recoverySetup();
  expect(() =>
    createActorAnimator(
      {
        ...h.context,
        posePolicy: {
          ...h.context.posePolicy,
          startup: startupPolicy,
          attackStartStance: 'selected-side-kicks-v1',
        },
      },
      h.assets,
    ),
  ).toThrow(/startup/i);
  expect(h.events).toEqual([]);
});
test('startup-only policy uses whole-frame preparation and rejects late-invalid actor before any write', () => {
  const h = recoverySetup('blue', true);
  const a = createActorAnimator(
    {
      ...h.context,
      posePolicy: {
        version: 1,
        mode: 'deterministic-pose-v1',
        startup: startupPolicy,
        attackStartStance: 'selected-side-kicks-v1',
      },
    },
    {
      ...h.assets,
      startupCapability: {
        version: 1,
        protocol: 'side-kick-startup-matrix-v1',
        fixedLiftSign: 1,
        deathLayerPolicy: 'freeze-entry-through-local-death-v1',
      },
    },
  );
  expect(() => a.render(stamped(25, [player, blue]))).toThrow(/layer/i);
  expect(
    h.events.filter((e) =>
      /:mount|:emission|:apply|:pose|:death|:detach/.test(e),
    ),
  ).toEqual([]);
  a.dispose();
});

test.each(['prepare', 'apply'] as const)(
  'startup animator rejects materialized rig missing %s before visible writes',
  (missing) => {
    const h = recoverySetup(undefined, true);
    const a = createActorAnimator(
      {
        ...h.context,
        posePolicy: {
          version: 1,
          mode: 'deterministic-pose-v1',
          startup: startupPolicy,
          attackStartStance: 'selected-side-kicks-v1',
        },
      },
      {
        ...h.assets,
        startupCapability: STARTUP_FRAME_CAPABILITY,
        stageActor: (color) => {
          const stage = h.assets.stageActor(color),
            frame = { ...stage.poseFrame };
          return {
            ...stage,
            poseFrame: frame,
            materialize() {
              const rig = stage.materialize();
              Object.assign(frame, { [missing]: undefined });
              return { ...rig, poseFrame: frame };
            },
          };
        },
      },
    );
    expect(() => a.render(stamped(25, [player, blue]))).toThrow(
      /capability|preparation/i,
    );
    expect(
      h.events.filter((e) => /:mount|:emission|:apply|:detach/.test(e)),
    ).toEqual([]);
    expect(h.events.filter((e) => /:dispose/.test(e))).toHaveLength(1);
    a.dispose();
  },
);

test.each(['prepare', 'apply'] as const)(
  'startup initial CPU stage missing %s preserves old residents before retirement',
  (missing) => {
    const h = recoverySetup(undefined, true),
      a = createActorAnimator(
        {
          ...h.context,
          posePolicy: {
            version: 1,
            mode: 'deterministic-pose-v1',
            startup: startupPolicy,
            attackStartStance: 'selected-side-kicks-v1',
          },
        },
        {
          ...h.assets,
          startupCapability: STARTUP_FRAME_CAPABILITY,
          stageActor: (color) => {
            const handle = h.assets.stageActor(color);
            return color === 'blue'
              ? {
                  ...handle,
                  poseFrame: {
                    ...handle.poseFrame,
                    [missing]: undefined,
                  } as unknown as typeof handle.poseFrame,
                }
              : handle;
          },
        },
      );
    a.render(stamped(0, [player, black], 1));
    h.events.length = 0;
    expect(() => a.render(stamped(25, [player, blue], 2))).toThrow(
      /capability|preparation/i,
    );
    expect(h.events).not.toContain('black:dispose');
    expect(h.events).not.toContain('blue:create');
    expect(
      h.events.filter((e) => /:mount|:emission|:apply|:detach/.test(e)),
    ).toEqual([]);
    expect(h.events).toContain('blue:stage-dispose');
    // Failed preflight must not tombstone the old resident or advance its frontier.
    expect(() => a.render(stamped(0, [player, black], 1))).not.toThrow();
    a.dispose();
  },
);

import { STARTUP_FRAME_CAPABILITY_V2 } from '../../src/assets/poseFramePreparation';
test.each([false, true])(
  'startup v2 wire animator rejects v1-only asset or staged driver stage=%s',
  (stage) => {
    const h = recoverySetup(undefined, true);
    const context = {
      ...h.context,
      posePolicy: {
        version: 1 as const,
        mode: 'deterministic-pose-v1' as const,
        attackStartStance: 'selected-side-kicks-v1' as const,
        startup: {
          version: 2 as const,
          protocol: 'side-kick-startup-matrix-v2' as const,
          durationMs: durationMs(100),
          fixedLiftSign: 1 as const,
          domain: 'fixed-positive-lift-midpoint-half-v1' as const,
        },
      },
    };
    const assets = {
      ...h.assets,
      startupCapability: stage
        ? STARTUP_FRAME_CAPABILITY_V2
        : STARTUP_FRAME_CAPABILITY,
    };
    if (!stage)
      expect(() => createActorAnimator(context, assets)).toThrow(
        'Missing matching startup frame capability',
      );
    else {
      const animator = createActorAnimator(context, assets);
      expect(() => animator.render(stamped(25, [player, blue]))).toThrow(
        'Missing matching startup frame capability',
      );
      animator.dispose();
    }
    expect(
      h.events.filter((e) => /:mount|:emission|:apply|:pose|:death/.test(e)),
    ).toEqual([]);
  },
);

test('finite composition whole frame failure preserves old residents with zero writes or retirements', () => {
  const h = recoverySetup('blue', false, true),
    a = createActorAnimator(h.context, h.assets);
  try {
    a.render(stamped(0, [player, black], 1));
    const start = h.events.length;
    expect(() => a.render(stamped(25, [player, blue], 2))).toThrow(
      'Unsupported singular/unrepresentable matrix domain',
    );
    expect(
      h.events
        .slice(start)
        .filter((e) =>
          /:mount|:emission|:apply|:pose|:death|:detach|:create|black:dispose|white:dispose/.test(
            e,
          ),
        ),
    ).toEqual([]);
  } finally {
    a.dispose();
  }
});

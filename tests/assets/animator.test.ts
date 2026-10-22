import { expect, test } from 'vitest';
import {
  type ActorRig,
  createActorAnimator,
} from '../../src/assets/actorAnimator';
import {
  type AnimationModuleContext,
  activeRealTimeMs,
  actorId,
  type CommittedFrame,
  clipId,
  durationMs,
  gameTimeMs,
  presentationTimeMs,
  runId,
  tick,
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
test('animation mounts once, seeks absolute game time at rate one, ignores stale frames and disposes B-owned resources after detach', () => {
  const order: string[] = [];
  const seeks: { clip: string; time: number }[] = [];
  const node = {};
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: ({ node: mounted }) => {
        expect(mounted).toBe(node);
        order.push('mount');
        return () => {
          order.push('detach');
        };
      },
    },
  };
  const rig: ActorRig<object> = {
    node,
    seek: (clip, time) => {
      seeks.push({ clip, time });
    },
    setEmissiveEnabled: () => {},
    dispose: () => {
      order.push('dispose');
    },
  };
  const animator = createActorAnimator(context, {
    create: () => rig,
    clipDuration: () => durationMs(1000),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  animator.render(frame(0));
  animator.render(frame(250));
  animator.render(frame(250));
  expect(order).toEqual(['mount']);
  expect(seeks.at(-1)).toEqual({ clip: 'Idle', time: 0.25 });
  const stale = frame(500);
  animator.render({
    ...stale,
    snapshot: { ...stale.snapshot, runId: runId('stale') },
  });
  expect(seeks).toHaveLength(3);
  animator.dispose();
  animator.dispose();
  expect(order).toEqual(['mount', 'detach', 'dispose']);
});
test('failed mount releases unreturned resources and removed actors do not leak', () => {
  let disposed = 0;
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: () => {
        throw new Error('mount failure');
      },
    },
  };
  const animator = createActorAnimator(context, {
    create: () => ({
      node: {},
      seek: () => {},
      setEmissiveEnabled: () => {},
      dispose: () => {
        disposed++;
      },
    }),
    clipDuration: () => durationMs(1000),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  expect(() => animator.render(frame())).toThrow('mount failure');
  expect(disposed).toBe(1);
  animator.dispose();
});

test('missed defeat frames seek durable A death timing and never revert a defeated actor to idle', () => {
  const seeks: { clip: string; time: number }[] = [];
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: { runId: run, mountActor: () => () => {} },
  };
  const animator = createActorAnimator(context, {
    create: () => ({
      node: {},
      seek: (clip, time) => {
        seeks.push({ clip, time });
      },
      setEmissiveEnabled: () => {},
      dispose: () => {},
    }),
    clipDuration: () => durationMs(500),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  const input = frame(1500);
  const actor = input.snapshot.actors[0];
  if (!actor) throw new Error('Fixture');
  const dead = {
    ...input,
    snapshot: {
      ...input.snapshot,
      actors: [
        {
          ...actor,
          hp: 0,
          defeated: true,
          defeatPresentation: {
            category: 'kick' as const,
            startedAt: presentationTimeMs(0),
            slowDurationMs: durationMs(1500),
            playbackRate: 0.25 as const,
          },
        },
      ],
    },
  };
  animator.render(dead);
  expect(seeks.at(-1)).toEqual({ clip: 'DefeatKick', time: 0.375 });
  animator.render({
    ...dead,
    snapshot: {
      ...dead.snapshot,
      clocks: {
        ...dead.snapshot.clocks,
        presentationTimeMs: presentationTimeMs(1625),
      },
    },
  });
  expect(seeks.at(-1)).toEqual({ clip: 'DefeatKick', time: 0.5 });
  animator.dispose();
});
test('bounds capability is fixed at mount, publishes after seek, and cannot downgrade unavailable/rejected observations', () => {
  const events: string[] = [],
    published: import('../../src/contracts').DefeatPoseSupportObservation[] =
      [];
  let available = true,
    accept = true;
  const rig: ActorRig<object> = {
    node: {},
    seek: (_id, _time, activation) => {
      expect(activation).toBe(presentationTimeMs(100));
      events.push('seek');
    },
    defeatPoseSupport: () =>
      available
        ? {
            entryLocalMinY: -1.3,
            currentLocalBounds: {
              min: { x: -1, y: -0.2, z: -0.3 },
              max: { x: 1, y: 2, z: 0.4 },
            },
          }
        : undefined,
    setEmissiveEnabled: () => {},
    dispose: () => events.push('dispose'),
  };
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: (request) => {
        expect(request.defeatPoseSupport).toBe('bounds-v1');
        events.push('mount');
        return () => events.push('detach');
      },
      publishDefeatPoseSupport: (observation) => {
        published.push(observation);
        events.push('publish');
        return accept;
      },
    },
  };
  const assets = {
    create: () => rig,
    clipDuration: () => durationMs(500),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  };
  const animator = createActorAnimator(context, assets),
    input = frame(700),
    actor = input.snapshot.actors[0];
  if (!actor) throw new Error('Fixture');
  const dead: CommittedFrame = {
    ...input,
    snapshot: {
      ...input.snapshot,
      actors: [
        {
          ...actor,
          defeated: true,
          hp: 0,
          defeatPresentation: {
            category: 'punch',
            startedAt: presentationTimeMs(100),
            slowDurationMs: durationMs(2000),
            playbackRate: 0.25,
          },
        },
      ],
    },
  };
  animator.render(dead);
  expect(events).toEqual(['mount', 'seek', 'publish']);
  expect(published[0]).toMatchObject({
    runId: run,
    actorId: player,
    defeatStartedAt: 100,
    tick: 0,
    presentationTimeMs: 700,
    entryLocalMinY: -1.3,
  });
  available = false;
  expect(() => animator.render(dead)).toThrow('Unavailable inherited');
  expect(published).toHaveLength(1);
  available = true;
  accept = false;
  expect(() => animator.render(dead)).toThrow('publication rejected');
  animator.dispose();
  const missing = createActorAnimator(
    {
      ...context,
      renderHost: {
        runId: run,
        mountActor: () => {
          throw new Error('Must not mount');
        },
      },
    },
    assets,
  );
  expect(() => missing.render(dead)).toThrow('requires support host');
  expect(events.at(-1)).toBe('dispose');
  missing.dispose();
});
test('authoritative residency keeps only the active pair, completes the original death, and irreversibly releases retired rigs', () => {
  const calls: string[] = [];
  const seeks: { color: string; clip: string; seconds: number }[] = [];
  const colors = ['white', 'black', 'blue', 'green', 'yellow'] as const;
  const context: AnimationModuleContext<object> = {
    runId: run,
    seed: 1,
    viewport: { read: () => frame().viewport, subscribe: () => () => {} },
    renderHost: {
      runId: run,
      mountActor: ({ actorId: id }) => {
        calls.push(`mount:${id}`);
        return () => calls.push(`detach:${id}`);
      },
    },
  };
  const animator = createActorAnimator(context, {
    create: (color) => {
      calls.push(`create:${color}`);
      return {
        node: {},
        seek: (clip, seconds) => seeks.push({ color, clip, seconds }),
        setEmissiveEnabled: () => {},
        dispose: () => calls.push(`dispose:${color}`),
      };
    },
    clipDuration: () => durationMs(500),
    locomotionClips: {
      idle: clipId('Idle'),
      walk: clipId('Walk'),
      run: clipId('Run'),
      jump: clipId('Jump'),
    },
  });
  function roster(
    time: number,
    residents: readonly string[],
    dead = false,
  ): CommittedFrame {
    const base = frame(time),
      actor = base.snapshot.actors[0],
      spatial = base.spatial.actors[0];
    if (!actor || !spatial) throw new Error('Fixture');
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        revision: Math.floor(time * 1000) + 1,
        actors: colors.map((color) => ({
          ...actor,
          actorId: actorId(color),
          color,
          ...(color === 'black' && dead
            ? {
                hp: 0,
                defeated: true,
                defeatPresentation: {
                  category: 'kick' as const,
                  startedAt: presentationTimeMs(0),
                  slowDurationMs: durationMs(1500),
                  playbackRate: 0.25 as const,
                },
              }
            : {}),
        })),
        residentActorIds: residents.map(actorId),
        currentOpponentId: actorId(time < 1625 ? 'black' : 'blue'),
      },
      spatial: {
        ...base.spatial,
        actors: colors.map((color) => ({
          ...spatial,
          actorId: actorId(color),
        })),
      },
    };
  }
  const first = roster(0, ['white', 'black']);
  animator.render(first);
  expect(calls).toEqual([
    'create:white',
    'mount:white',
    'create:black',
    'mount:black',
  ]);
  const finishing = roster(1500, ['white', 'black'], true);
  animator.render(finishing);
  expect(seeks.filter((item) => item.color === 'black').at(-1)).toEqual({
    color: 'black',
    clip: 'DefeatKick',
    seconds: 0.375,
  });
  animator.render(roster(1624.999, ['white', 'black'], true));
  expect(
    seeks.filter((item) => item.color === 'black').at(-1)?.seconds,
  ).toBeCloseTo(0.499999, 8);
  const next = roster(1625, ['white', 'blue'], true);
  animator.render(next);
  expect(calls.slice(-4)).toEqual([
    'detach:black',
    'dispose:black',
    'create:blue',
    'mount:blue',
  ]);
  const beforeReplay = [...calls],
    beforeSeeks = seeks.length;
  expect(() => animator.render(finishing)).toThrow('Retired actor');
  expect(calls).toEqual(beforeReplay);
  expect(seeks).toHaveLength(beforeSeeks);
  animator.render(next); // Still-resident replay remains valid.
  expect(
    calls.some((call) => call.includes('green') || call.includes('yellow')),
  ).toBe(false);
  for (const residents of [
    ['white', 'white'],
    ['white', 'missing'],
  ])
    expect(() => animator.render(roster(1700, residents, true))).toThrow(
      'residen',
    );
  const { residentActorIds: _ignored, ...legacy } = next.snapshot;
  expect(() => animator.render({ ...next, snapshot: legacy })).toThrow(
    'residency mode',
  );
  animator.dispose();
  animator.dispose();
  expect(calls.filter((call) => call === 'dispose:black')).toHaveLength(1);
  expect(calls.slice(-4)).toEqual([
    'detach:white',
    'dispose:white',
    'detach:blue',
    'dispose:blue',
  ]);
});

test('real retired rigs release local materials, skeleton textures and death captures without freeing the surviving shared mesh', async () => {
  const { readFileSync } = await import('node:fs');
  const { Group, SkinnedMesh } = await import('three');
  const { createThreeAssetPack } = await import(
    '../../src/assets/threeAssetPack'
  );
  const { authorDeathClips } = await import('../../src/assets/deathAnimation');
  const { SOURCE_PALETTES } = await import('../../src/assets/sourcePalettes');
  const bytes = ['movement', 'jump', 'punch', 'kick'].map(
    (category) =>
      new Uint8Array(
        readFileSync(
          `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
        ),
      ),
  );
  const original = await createThreeAssetPack(bytes),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  const deaths = authorDeathClips(seed.node);
  seed.dispose();
  original.dispose();
  const pack = await createThreeAssetPack(bytes, SOURCE_PALETTES, deaths);
  const rigs = new Map<string, ActorRig<import('three').Object3D>>(),
    scene = new Group();
  const created: string[] = [],
    published: string[] = [];
  const animator = createActorAnimator<import('three').Object3D>(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => frame().viewport, subscribe: () => () => {} },
      renderHost: {
        runId: run,
        mountActor: ({ node }) => {
          scene.add(node);
          return () => scene.remove(node);
        },
        publishDefeatPoseSupport: (observation) => {
          published.push(observation.actorId);
          return true;
        },
      },
    },
    {
      create: (color) => {
        created.push(color);
        const rig = pack.create(color);
        rigs.set(color, rig);
        return rig;
      },
      clipDuration: (id) => pack.clipDuration(id),
      locomotionClips: {
        idle: clipId('Idle'),
        walk: clipId('Walk'),
        run: clipId('Run'),
        jump: clipId('Jump'),
      },
    },
  );
  function selected(
    time: number,
    residents: readonly string[],
    dead: boolean,
  ): CommittedFrame {
    const base = frame(time),
      actor = base.snapshot.actors[0],
      spatial = base.spatial.actors[0];
    if (!actor || !spatial) throw new Error('Fixture');
    const colors = ['white', 'black', 'blue', 'green', 'yellow'] as const;
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        revision: Math.floor(time * 1000) + 1,
        residentActorIds: residents.map(actorId),
        actors: colors.map((color) => ({
          ...actor,
          actorId: actorId(color),
          color,
          ...(color === 'black' && dead
            ? {
                hp: 0,
                defeated: true,
                defeatPresentation: {
                  category: 'punch' as const,
                  startedAt: presentationTimeMs(0),
                  slowDurationMs: durationMs(1500),
                  playbackRate: 0.25 as const,
                },
              }
            : {}),
        })),
      },
      spatial: {
        ...base.spatial,
        actors: colors.map((color) => ({
          ...spatial,
          actorId: actorId(color),
        })),
      },
    };
  }
  try {
    animator.render(selected(0, ['white', 'black'], false));
    const black = rigs.get('black');
    if (!black) throw new Error('Fixture');
    const geometries = new Set<import('three').BufferGeometry>(),
      materials = new Set<import('three').Material>(),
      skeletons = new Set<import('three').Skeleton>();
    let geometryDisposed = 0,
      materialDisposed = 0,
      textureDisposed = 0;
    black.node.traverse((node) => {
      if (node instanceof SkinnedMesh) {
        geometries.add(node.geometry);
        skeletons.add(node.skeleton);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries)
      geometry.addEventListener('dispose', () => geometryDisposed++);
    for (const material of materials)
      material.addEventListener('dispose', () => materialDisposed++);
    for (const skeleton of skeletons) {
      skeleton.computeBoneTexture();
      skeleton.boneTexture?.addEventListener(
        'dispose',
        () => textureDisposed++,
      );
    }
    animator.render(selected(1500, ['white', 'black'], true));
    expect(black.defeatPoseSupport?.()).toBeDefined();
    expect(published).toEqual(['black']);
    animator.render(selected(1625, ['white', 'blue'], true));
    expect(created).toEqual(['white', 'black', 'blue']);
    expect(scene.children).toHaveLength(2);
    expect(black.node.parent).toBeNull();
    expect(black.defeatPoseSupport?.()).toBeUndefined();
    expect(materialDisposed).toBe(materials.size);
    expect(textureDisposed).toBe(skeletons.size);
    expect(geometryDisposed).toBe(0);
    animator.render(selected(1800, ['white', 'blue'], true));
    expect(published).toEqual(['black']);
    animator.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometryDisposed).toBe(0);
    pack.dispose();
    expect(geometryDisposed).toBe(geometries.size);
    animator.dispose();
    pack.dispose();
    expect(geometryDisposed).toBe(geometries.size);
  } finally {
    animator.dispose();
    pack.dispose();
  }
}, 30000);

test('invalid or stale resident frames are preflighted without retiring current resources', () => {
  const operations: string[] = [];
  const animator = createActorAnimator<object>(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => frame().viewport, subscribe: () => () => {} },
      renderHost: {
        runId: run,
        mountActor: ({ actorId: id }) => {
          operations.push(`mount:${id}`);
          return () => operations.push(`detach:${id}`);
        },
      },
    },
    {
      create: (color) => {
        operations.push(`create:${color}`);
        return {
          node: {},
          seek: () => operations.push(`seek:${color}`),
          setEmissiveEnabled: () => {},
          dispose: () => operations.push(`dispose:${color}`),
        };
      },
      clipDuration: (id) =>
        id === clipId('Unavailable') ? undefined : durationMs(500),
      locomotionClips: {
        idle: clipId('Idle'),
        walk: clipId('Walk'),
        run: clipId('Run'),
        jump: clipId('Jump'),
      },
    },
  );
  function incoming(
    revision: number,
    residents: readonly string[],
  ): CommittedFrame {
    const base = frame(),
      actor = base.snapshot.actors[0],
      pose = base.spatial.actors[0];
    if (!actor || !pose) throw new Error('Fixture');
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        revision,
        residentActorIds: residents.map(actorId),
        actors: (['white', 'black', 'blue'] as const).map((color) => ({
          ...actor,
          actorId: actorId(color),
          color,
        })),
      },
      spatial: {
        ...base.spatial,
        actors: ['white', 'black', 'blue'].map((id) => ({
          ...pose,
          actorId: actorId(id),
        })),
      },
    };
  }
  animator.render(incoming(0, ['white']));
  const current = incoming(10, ['white', 'black']);
  animator.render(current);
  const before = [...operations];
  for (const invalid of [
    incoming(0, ['white']),
    incoming(10, ['white', 'blue']),
  ]) {
    expect(() => animator.render(invalid)).toThrow('resident');
    expect(operations).toEqual(before);
  }
  const malformed = incoming(11, ['white', 'blue']);
  Object.defineProperty(malformed.snapshot, 'residentActorIds', {
    value: null,
  });
  expect(() => animator.render(malformed)).toThrow('resident');
  expect(operations).toEqual(before);
  const dead = incoming(11, ['white', 'blue']);
  const missingDeath = {
    ...dead,
    snapshot: {
      ...dead.snapshot,
      actors: dead.snapshot.actors.map((actor) =>
        actor.color === 'blue' ? { ...actor, defeated: true } : actor,
      ),
    },
  };
  expect(() => animator.render(missingDeath)).toThrow('defeat presentation');
  expect(operations).toEqual(before);
  const badClip = incoming(11, ['white', 'blue']);
  Object.defineProperty(badClip.spatial.actors[2], 'locomotion', {
    value: 'missing',
  });
  expect(() => animator.render(badClip)).toThrow('animation clip');
  expect(operations).toEqual(before);
  const badColor = incoming(11, ['white', 'blue']);
  Object.defineProperty(badColor.snapshot.actors[2], 'color', {
    value: 'missing',
  });
  expect(() => animator.render(badColor)).toThrow('actor color');
  expect(operations).toEqual(before);
  const missingPose = incoming(11, ['white', 'blue']);
  expect(() =>
    animator.render({
      ...missingPose,
      spatial: {
        ...missingPose.spatial,
        actors: missingPose.spatial.actors.filter(
          (pose) => pose.actorId !== actorId('blue'),
        ),
      },
    }),
  ).toThrow('resident spatial');
  expect(operations).toEqual(before);
  for (const invalid of [NaN, Infinity, -1]) {
    const malformedDeath = incoming(11, ['white', 'blue']);
    Object.defineProperty(malformedDeath.snapshot.actors[2], 'defeated', {
      value: true,
    });
    Object.defineProperty(
      malformedDeath.snapshot.actors[2],
      'defeatPresentation',
      {
        value: {
          category: 'punch',
          startedAt: invalid,
          slowDurationMs: 1500,
          playbackRate: 0.25,
        },
      },
    );
    expect(() => animator.render(malformedDeath)).toThrow(
      'defeat presentation',
    );
    expect(operations).toEqual(before);
    const malformedClock = incoming(11, ['white', 'blue']);
    Object.defineProperty(
      malformedClock.snapshot.clocks,
      'presentationTimeMs',
      { value: invalid },
    );
    expect(() => animator.render(malformedClock)).toThrow('animation clock');
    expect(operations).toEqual(before);
  }
  const missingEntry = incoming(11, ['white', 'blue']);
  Object.defineProperty(missingEntry.snapshot.actors[2], 'defeated', {
    value: true,
  });
  Object.defineProperty(missingEntry.snapshot.actors[2], 'defeatPresentation', {
    value: {
      category: 'kick',
      startedAt: 0,
      slowDurationMs: 1500,
      playbackRate: 0.25,
    },
  });
  expect(() => animator.render(missingEntry)).toThrow('inherited defeat entry');
  expect(operations).toEqual(before);
  animator.render(current); // Identical retry has not lost black or spent revision 11.
  expect(operations.filter((value) => value === 'create:black')).toHaveLength(
    1,
  );
  animator.render(incoming(2, ['white', 'black'])); // Historical same-lifetime pose replay.
  const afterReplay = [...operations];
  expect(() => animator.render(incoming(9, ['white']))).toThrow('resident');
  expect(operations).toEqual(afterReplay); // Older replay cannot lower the frontier.
  animator.render(incoming(11, ['white', 'blue'])); // Invalid attempts did not retire or poison IDs.
  expect(operations).toContain('dispose:black');
  animator.dispose();
});

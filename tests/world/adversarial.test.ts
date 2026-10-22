import { expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  clipId,
  commandId,
  durationMs,
  type GameplayCommand,
  gameTimeMs,
  impactId,
  MOTION_SPACE,
  type MotionIntervalSample,
  worldObjectId,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';

const kick = {
  activationId: attackActivationId('activation'),
  clipId: clipId('kick'),
  category: 'kick' as const,
  startedAt: gameTimeMs(0),
  consumedImpacts: [],
  impactBindings: [{ impactIndex: 0, impactId: impactId('runtime') }],
};
const sample: MotionIntervalSample = {
  clipId: clipId('kick'),
  fromMs: durationMs(0),
  toMs: durationMs(20),
  space: MOTION_SPACE,
  rootSegments: [],
  hitVolumeSegments: [
    {
      impactIndex: 0,
      shapeId: 'foot',
      fromMs: durationMs(0),
      toMs: durationMs(20),
      activeWindow: { startMs: durationMs(0), endMs: durationMs(20) },
      from: { kind: 'sphere', center: { x: 0, y: 1, z: 0 }, radiusM: 0.2 },
      to: { kind: 'sphere', center: { x: 0, y: 1, z: 5 }, radiusM: 0.2 },
    },
  ],
};
const request = (actors: ReturnType<typeof actor>[]) => ({
  snapshot: state(1, { actors }),
  step: { durationMs: durationMs(20) },
  intents: [],
});
test('actor array order cannot alter physical headings or contacts', () => {
  const base = createParisStreetLayout();
  const layout = {
    ...base,
    actorSpawns: {
      ...base.actorSpawns,
      white: { x: 0, y: 0, z: 0 },
      blue: { x: 0, y: 0, z: 1 },
    },
  };
  const actors = [actor('white'), actor('blue')];
  const one = createSpatialEngine(run, layout),
    two = createSpatialEngine(run, layout);
  one.commit({ snapshot: state(0, { actors }), events: [] });
  two.commit({
    snapshot: state(0, { actors: [...actors].reverse() }),
    events: [],
  });
  const a = one.begin('x', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    b = two.begin('x', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  expect(a).toEqual(b);
  const movement: GameplayCommand = {
    type: 'MoveRequested',
    runId: run,
    actorId: actorId('white'),
    input: { commandId: commandId('move'), sequence: 1 },
    x: 1,
    z: 0,
    movementSessionId: 'x',
    basisRevision: a.revision,
  };
  const first = one.step({ ...request(actors), intents: [movement] }, catalog())
    .snapshot.actors;
  const second = two.step(
    { ...request([...actors].reverse()), intents: [movement] },
    catalog(),
  ).snapshot.actors;
  expect([...first].sort((a, b) => a.actorId.localeCompare(b.actorId))).toEqual(
    [...second].sort((a, b) => a.actorId.localeCompare(b.actorId)),
  );
});
test('direct street damage retains A impact source and excludes destroyed objects', () => {
  const base = createParisStreetLayout(),
    id = worldObjectId('test-wall');
  const layout = {
    ...base,
    objects: [
      {
        objectId: id,
        position: { x: 0, y: 1, z: 2 },
        halfExtents: { x: 1, y: 1, z: 0.01 },
      },
    ],
  };
  const world = {
    vehicles: [],
    objects: [
      { objectId: id, durability: 100, maxDurability: 100, destroyed: false },
    ],
  };
  const actors = [{ ...actor('white'), attack: kick }, actor('blue')];
  const e = createSpatialEngine(run, layout);
  e.commit({ snapshot: state(0, { actors, world }), events: [] });
  const result = e.step(
    { ...request(actors), snapshot: state(1, { actors, world }) },
    catalog(sample),
  );
  const damage = result.candidates.find((c) => c.kind === 'destruction');
  expect(damage?.kind === 'destruction' && damage.source?.impactId).toBe(
    'runtime',
  );
});
test('nonorthogonal or nonfinite movement bases are rejected', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  expect(() =>
    e.begin('bad', { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
  ).toThrow();
  expect(() =>
    e.begin('nan', { x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
  ).toThrow();
});
test('a skipped fixed tick is rejected rather than silently dropping world time', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  e.commit({ snapshot: state(), events: [] });
  expect(() =>
    e.step(
      { snapshot: state(2), step: { durationMs: durationMs(20) }, intents: [] },
      catalog(),
    ),
  ).toThrow();
});
test('inactive actors cannot retain active locomotion after opponent changes', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  e.commit({ snapshot: state(), events: [] });
  e.begin('enemy', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const move: GameplayCommand = {
    type: 'MoveRequested',
    runId: run,
    actorId: actorId('blue'),
    input: { commandId: commandId('enemy-move'), sequence: 1 },
    x: 1,
    z: 0,
    movementSessionId: 'enemy',
    basisRevision: 1,
  };
  e.step(
    { ...request([actor('white'), actor('blue')]), intents: [move] },
    catalog(),
  );
  const s = e.commit({
    snapshot: state(1, { revision: 2, currentOpponentId: null }),
    events: [],
  });
  expect(s.actors.find((a) => a.actorId === 'blue')?.locomotion).toBe('idle');
});
test('punch on a car reports direct damage provenance rather than a launch', () => {
  const layout = createParisStreetLayout(),
    vehicle = layout.vehicles[0];
  if (!vehicle) throw new Error('fixture');
  const carLayout = {
    ...layout,
    vehicles: [{ ...vehicle, position: { x: 0, y: 0, z: 2 } }],
  };
  const world = {
    objects: [],
    vehicles: [
      {
        vehicleId: vehicle.vehicleId,
        hp: 100,
        maxHp: 100,
        broken: false,
        canLaunch: true,
        activeLaunchId: null,
      },
    ],
  };
  const actors = [
    { ...actor('white'), attack: { ...kick, category: 'punch' as const } },
    actor('blue'),
  ];
  const e = createSpatialEngine(run, carLayout);
  e.commit({ snapshot: state(0, { actors, world }), events: [] });
  const result = e.step(
    { ...request(actors), snapshot: state(1, { actors, world }) },
    catalog(sample),
  );
  expect(result.candidates.some((c) => c.kind === 'vehicle-launch')).toBe(
    false,
  );
  const damage = result.candidates.find((c) => c.kind === 'destruction');
  expect(damage?.kind === 'destruction' && damage.source?.impactId).toBe(
    'runtime',
  );
});
test('a missing runtime binding fails closed instead of inventing an impact identity', () => {
  const e = createSpatialEngine(run, createParisStreetLayout()),
    actors = [
      { ...actor('white'), attack: { ...kick, impactBindings: [] } },
      actor('blue'),
    ];
  e.commit({ snapshot: state(0, { actors }), events: [] });
  expect(() => e.step(request(actors), catalog(sample))).toThrow(
    'Unbound runtime impact',
  );
});
test('root-driven motion sweeps a thin wall rather than teleporting through it', () => {
  const base = createParisStreetLayout();
  const wall = {
    objectId: worldObjectId('thin'),
    position: { x: 0, y: 2, z: 2 },
    halfExtents: { x: 5, y: 2, z: 0.01 },
  };
  const e = createSpatialEngine(run, { ...base, objects: [wall] }),
    actors = [{ ...actor('white'), attack: kick }, actor('blue')];
  e.commit({ snapshot: state(0, { actors }), events: [] });
  const rootSample = {
    ...sample,
    hitVolumeSegments: [],
    rootSegments: [
      {
        from: {
          atMs: durationMs(0),
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        },
        to: {
          atMs: durationMs(20),
          position: { x: 0, y: 0, z: 10 },
          visualYawRad: 0,
        },
        deltaTranslation: { x: 0, y: 0, z: 10 },
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'spatial-jump' as const,
        yawOwner: 'visual-only' as const,
      },
    ],
  };
  const result = e.step(request(actors), catalog(rootSample));
  expect(
    result.snapshot.actors.find((a) => a.actorId === 'white')?.position.z,
  ).toBeLessThan(1.65);
});
test('two actors using one clip retain distinct A activation/impact bindings on clashes', () => {
  const layout = createParisStreetLayout();
  const actors = [
    { ...actor('white'), attack: kick },
    {
      ...actor('blue'),
      attack: {
        ...kick,
        activationId: attackActivationId('enemy-activation'),
        impactBindings: [
          { impactIndex: 0, impactId: impactId('enemy-impact') },
        ],
      },
    },
  ];
  const e = createSpatialEngine(run, {
    ...layout,
    actorSpawns: { ...layout.actorSpawns, blue: { x: 0, y: 0, z: 4 } },
  });
  e.commit({ snapshot: state(0, { actors }), events: [] });
  const result = e.step(request(actors), catalog(sample));
  const clash = result.candidates.find((c) => c.kind === 'clash');
  expect(
    clash?.kind === 'clash' &&
      new Set([clash.first.impactId, clash.second.impactId]),
  ).toEqual(new Set(['runtime', 'enemy-impact']));
});

import { expect, test } from 'vitest';
import {
  actorId,
  contactId,
  type DomainEvent,
  domainEventId,
  durationMs,
  gameTimeMs,
  launchId,
  vehicleId,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';

const car = vehicleId('paris:car:0'),
  launch = launchId('A-launch');
const world = {
  vehicles: [
    {
      vehicleId: car,
      hp: 80,
      maxHp: 100,
      broken: false,
      canLaunch: true,
      activeLaunchId: launch,
    },
  ],
  objects: [],
};
const approval: DomainEvent = {
  type: 'VehicleLaunchApproved',
  runId: run,
  eventId: domainEventId('approval'),
  sequence: 1,
  at: gameTimeMs(0),
  actorId: actorId('white'),
  vehicleId: car,
  launchId: launch,
  contact: {
    contactId: contactId('kick-car'),
    point: { x: 0, y: 1, z: 0 },
    impacts: [],
  },
};
function setup() {
  const layout = createParisStreetLayout();
  return createSpatialEngine(run, {
    ...layout,
    actorSpawns: {
      ...layout.actorSpawns,
      white: { x: 0, y: 0, z: 0 },
      blue: { x: 0, y: 0, z: 1 },
      black: { x: 0, y: 0, z: 1 },
    },
    vehicles: [
      {
        vehicleId: car,
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
      },
    ],
  });
}
test('permission alone never launches; approved launch moves only the next tick', () => {
  const e = setup();
  const first = e.commit({ snapshot: state(0, { world }), events: [] });
  expect(first.vehicles[0]?.velocity).toEqual({ x: 0, y: 0, z: 0 });
  const approved = e.commit({
    snapshot: state(0, { world }),
    events: [approval],
  });
  expect(approved.vehicles[0]?.position).toEqual(first.vehicles[0]?.position);
  const next = e.step(
    {
      snapshot: state(1, { world }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    catalog(),
  );
  expect(next.snapshot.vehicles[0]?.position.z).toBeGreaterThan(0);
  const committed = e.commit({
    snapshot: state(1, { world }),
    events: [approval],
  });
  expect(committed.vehicles).toEqual(next.snapshot.vehicles);
});
test('vehicle candidates exclude inactive enemies and preserve launch provenance', () => {
  const e = setup();
  const actors = [actor('white'), actor('blue'), actor('black')];
  e.commit({ snapshot: state(0, { world, actors }), events: [approval] });
  const result = e.step(
    {
      snapshot: state(1, { world, actors }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    catalog(),
  );
  const hits = result.candidates.filter((c) => c.kind === 'vehicle-contact');
  expect(hits.length).toBeGreaterThan(0);
  expect(
    hits.every(
      (c) =>
        c.kind === 'vehicle-contact' &&
        c.targetActorId === 'blue' &&
        c.launchId === launch,
    ),
  ).toBe(true);
});
test('broken or stale-run approvals cannot create a flight', () => {
  const e = setup();
  const broken = {
    ...world,
    vehicles: world.vehicles.map((v) => ({
      ...v,
      broken: true,
      canLaunch: false,
    })),
  };
  const s = e.commit({
    snapshot: state(0, { world: broken }),
    events: [approval],
  });
  expect(s.vehicles[0]?.launchId).toBeNull();
});
test('terminal flight remains frozen and emits no destruction', () => {
  const e = setup();
  e.commit({ snapshot: state(0, { world }), events: [approval] });
  const before = e.commit({ snapshot: state(0, { world }), events: [] });
  const after = e.step(
    {
      snapshot: state(1, { world, phase: 'terminal' }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    catalog(),
  );
  expect(after.snapshot.vehicles).toEqual(before.vehicles);
  expect(after.candidates).toEqual([]);
});
test('a fast car cannot damage a wall behind the first solid wall', () => {
  const base = createParisStreetLayout();
  const near = base.objects[0];
  const far = base.objects[1];
  if (!near || !far) throw new Error('fixture');
  const layout = {
    ...base,
    actorSpawns: { ...base.actorSpawns, blue: { x: 0, y: 0, z: 10 } },
    vehicles: [
      {
        vehicleId: car,
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
      },
    ],
    objects: [
      {
        ...near,
        position: { x: 0, y: 2, z: 3 },
        halfExtents: { x: 3, y: 2, z: 0.01 },
      },
      {
        ...far,
        position: { x: 0, y: 2, z: 6 },
        halfExtents: { x: 3, y: 2, z: 0.01 },
      },
    ],
  };
  const authority = {
    ...world,
    objects: layout.objects.map((o) => ({
      objectId: o.objectId,
      durability: 100,
      maxDurability: 100,
      destroyed: false,
    })),
  };
  const e = createSpatialEngine(run, layout);
  e.commit({ snapshot: state(0, { world: authority }), events: [approval] });
  const result = e.step(
    {
      snapshot: state(1, {
        world: authority,
        clocks: { ...state(1).clocks, gameTimeMs: gameTimeMs(500) },
      }),
      step: { durationMs: durationMs(500) },
      intents: [],
    },
    catalog(),
  );
  const hits = result.candidates.filter((c) => c.kind === 'destruction');
  expect(hits).toHaveLength(1);
  expect(hits[0]?.kind === 'destruction' && hits[0].targetId).toBe(
    near.objectId,
  );
});
test('stale event sequence cannot replay an earlier launch under a new event ID', () => {
  const e = setup();
  e.commit({
    snapshot: state(0, { world }),
    events: [
      {
        type: 'OpponentChanged',
        runId: run,
        eventId: domainEventId('later'),
        sequence: 2,
        at: gameTimeMs(0),
        previousActorId: null,
        currentActorId: actorId('blue'),
      },
    ],
  });
  const s = e.commit({ snapshot: state(0, { world }), events: [approval] });
  expect(s.vehicles[0]?.launchId).toBeNull();
});
test('vehicle swept shape includes its front and rear, not only a center sphere', () => {
  const base = createParisStreetLayout();
  const layout = {
    ...base,
    actorSpawns: { ...base.actorSpawns, blue: { x: 0, y: 0, z: 2 } },
    vehicles: [
      {
        vehicleId: car,
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
      },
    ],
  };
  const e = createSpatialEngine(run, layout);
  e.commit({ snapshot: state(0, { world }), events: [approval] });
  const result = e.step(
    {
      snapshot: state(1, { world }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    catalog(),
  );
  expect(result.candidates.some((c) => c.kind === 'vehicle-contact')).toBe(
    true,
  );
});

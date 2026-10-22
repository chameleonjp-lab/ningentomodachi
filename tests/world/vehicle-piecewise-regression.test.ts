import { expect, test } from 'vitest';
import {
  actorId,
  contactId,
  domainEventId,
  gameTimeMs,
  launchId,
  type SpatialActor,
  type Vector3,
  vehicleId,
} from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { createVehicleSystem } from '../../src/world/vehicle-system';
import { actor, run, state } from './fixtures';

const id = vehicleId('car'),
  launch = launchId('launch');
function fixture() {
  const layout = {
    ...createParisStreetLayout(),
    objects: [],
    vehicles: [
      {
        vehicleId: id,
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
      },
    ],
  };
  const snapshot = state(0, {
    world: {
      objects: [],
      vehicles: [
        {
          vehicleId: id,
          hp: 80,
          maxHp: 100,
          broken: false,
          canLaunch: false,
          activeLaunchId: launch,
        },
      ],
    },
  });
  const system = createVehicleSystem(run, layout);
  const source: SpatialActor = {
    actorId: actorId('white'),
    position: { x: 0, y: 0, z: 0 },
    facing: { x: 0, y: 0, z: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    locomotion: 'idle',
  };
  system.commit(
    {
      snapshot,
      events: [
        {
          type: 'VehicleLaunchApproved',
          runId: run,
          eventId: domainEventId('approved'),
          sequence: 1,
          at: gameTimeMs(0),
          actorId: source.actorId,
          vehicleId: id,
          launchId: launch,
          contact: {
            contactId: contactId('contact'),
            point: { x: 0, y: 1, z: 0 },
            impacts: [],
          },
        },
      ],
    },
    new Map([[source.actorId, source]]),
  );
  return { system, snapshot, source };
}
const point = (x: number, z: number): Vector3 => ({ x, y: 1.5, z });
function target(
  path: readonly { at: number; position: Vector3 }[],
  source: SpatialActor,
) {
  return {
    state: actor('blue'),
    actor: { ...source, actorId: actorId('blue') },
    path,
    sample: undefined,
  };
}
test('an out-and-back root path crossing a car produces time-sliced contact', () => {
  const { system, snapshot, source } = fixture();
  const hits = system
    .step(snapshot, 0, 20, [
      target(
        [
          { at: 0, position: point(2, 0) },
          { at: 10, position: point(0, 0) },
          { at: 20, position: point(2, 0) },
        ],
        source,
      ),
    ])
    .filter((c) => c.kind === 'vehicle-contact');
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]?.at).toBeLessThan(10);
  expect(hits.every((c) => c.interval.to - c.interval.from <= 10)).toBe(true);
});
test('a piecewise detour around a car never becomes a straight-line hit', () => {
  const { system, snapshot, source } = fixture();
  const hits = system.step(snapshot, 0, 20, [
    target(
      [
        { at: 0, position: point(3, 0) },
        { at: 5, position: point(3, 5) },
        { at: 15, position: point(-3, 5) },
        { at: 20, position: point(-3, 0) },
      ],
      source,
    ),
  ]);
  expect(hits.filter((c) => c.kind === 'vehicle-contact')).toEqual([]);
});
test('extra collinear target keys preserve the first physical hit time', () => {
  const one = fixture(),
    two = fixture();
  const a = target(
      [
        { at: 0, position: point(3, 0) },
        { at: 20, position: point(-3, 0) },
      ],
      one.source,
    ),
    b = target(
      [
        { at: 0, position: point(3, 0) },
        { at: 7, position: point(0.9, 0) },
        { at: 13, position: point(-0.9, 0) },
        { at: 20, position: point(-3, 0) },
      ],
      two.source,
    );
  const first = one.system
      .step(one.snapshot, 0, 20, [a])
      .find((c) => c.kind === 'vehicle-contact'),
    second = two.system
      .step(two.snapshot, 0, 20, [b])
      .find((c) => c.kind === 'vehicle-contact');
  expect(first).toBeDefined();
  expect(second?.at).toBeCloseTo(first?.at ?? NaN, 5);
});

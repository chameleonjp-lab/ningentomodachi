import { expect, test } from 'vitest';
import {
  actorId,
  presentationTimeMs,
  launchId,
  domainEventId,
  contactId,
  attackActivationId,
  clipId,
  gameTimeMs,
  commandId,
  durationMs,
  type GameSnapshot,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';
const roster = ['white', 'blue', 'green', 'yellow', 'black'].map((c) =>
  actor(c as 'white' | 'blue' | 'green' | 'yellow' | 'black'),
);
function snapshot(n: number, ids: string[] = ['white', 'blue']): GameSnapshot {
  return state(n, {
    actors: roster,
    world: {
      vehicles: createParisStreetLayout().vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
        maxHp: 100,
        broken: false,
        canLaunch: true,
        activeLaunchId: null,
      })),
      objects: [],
    },
    residentActorIds: ids.map(actorId),
    currentOpponentId: ids.includes('green')
      ? actorId('green')
      : actorId('blue'),
  });
}
test('only resident robot poses exist, retired IDs cannot recreate, new run state is clean', () => {
  const layout = createParisStreetLayout(),
    e = createSpatialEngine(run, layout);
  try {
    const old = snapshot(0);
    expect(
      e.commit({ snapshot: old, events: [] }).actors.map((a) => a.actorId),
    ).toEqual(['white', 'blue']);
    const next = { ...snapshot(0, ['white', 'green']), revision: 1 };
    expect(
      e.commit({ snapshot: next, events: [] }).actors.map((a) => a.actorId),
    ).toEqual(['white', 'green']);
    expect(() => e.commit({ snapshot: old, events: [] })).toThrow();
    expect(
      e.commit({ snapshot: next, events: [] }).actors.map((a) => a.actorId),
    ).toEqual(['white', 'green']);
  } finally {
    e.dispose();
  }
  const fresh = createSpatialEngine(run, layout);
  try {
    expect(
      fresh
        .commit({ snapshot: snapshot(0), events: [] })
        .actors.map((a) => a.actorId),
    ).toEqual(['white', 'blue']);
  } finally {
    fresh.dispose();
  }
});
test('residency never suspends cars, street data, movement sessions or free movement', () => {
  const layout = createParisStreetLayout(),
    e = createSpatialEngine(run, layout);
  try {
    const initial = e.commit({ snapshot: snapshot(0), events: [] });
    e.begin('finger', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const next = snapshot(1, ['white', 'green']);
    const result = e.step(
      {
        snapshot: next,
        step: { durationMs: durationMs(20) },
        intents: [
          {
            type: 'MoveRequested',
            runId: run,
            actorId: actorId('white'),
            input: { commandId: commandId('move'), sequence: 1 },
            x: 1,
            z: 0,
            movementSessionId: 'finger',
            basisRevision: 1,
          },
        ],
      },
      catalog(),
    );
    expect(result.snapshot.vehicles).toEqual(initial.vehicles);
    expect(result.snapshot.vehicles.length).toBe(layout.vehicles.length);
    expect(
      result.snapshot.actors.find((a) => a.actorId === 'white')!.position.x,
    ).toBeGreaterThan(
      initial.actors.find((a) => a.actorId === 'white')!.position.x,
    );
    expect(result.snapshot.actors.map((a) => a.actorId)).toEqual([
      'white',
      'green',
    ]);
  } finally {
    e.dispose();
  }
});
test('nonresident future attack is never sampled even if logical data carries an attack', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  try {
    e.commit({ snapshot: snapshot(0, ['white']), events: [] });
    const c = catalog();
    let gets = 0;
    const result = e.step(
      {
        snapshot: {
          ...snapshot(1, ['white']),
          actors: roster.map((a) =>
            a.color === 'blue'
              ? {
                  ...a,
                  attack: {
                    activationId: attackActivationId('excluded'),
                    clipId: clipId('excluded'),
                    category: 'kick',
                    startedAt: gameTimeMs(0),
                    consumedImpacts: [],
                    impactBindings: [],
                  },
                }
              : a,
          ),
        },
        step: { durationMs: durationMs(20) },
        intents: [],
      },
      {
        ...c,
        get(id) {
          gets++;
          return c.get(id);
        },
        sampleMotion() {
          throw Error('unexpected sampling');
        },
      },
    );
    expect(gets).toBe(0);
    expect(result.snapshot.actors.map((a) => a.actorId)).toEqual(['white']);
  } finally {
    e.dispose();
  }
});

test('retiring the launch source leaves an approved car flight advancing normally', () => {
  const layout = createParisStreetLayout(),
    e = createSpatialEngine(run, layout),
    vehicle = layout.vehicles[0]!;
  const launched = launchId('resident-flight');
  const withFlight = (n: number, ids: string[]) => {
    const base = snapshot(n, ids);
    return {
      ...base,
      world: {
        ...base.world,
        vehicles: base.world.vehicles.map((v) =>
          v.vehicleId === vehicle.vehicleId
            ? { ...v, activeLaunchId: launched, canLaunch: false }
            : v,
        ),
      },
    };
  };
  try {
    const initial = e.commit({
      snapshot: withFlight(0, ['white', 'blue']),
      events: [
        {
          type: 'VehicleLaunchApproved',
          runId: run,
          eventId: domainEventId('approved-before-retire'),
          sequence: 1,
          at: gameTimeMs(0),
          actorId: actorId('blue'),
          vehicleId: vehicle.vehicleId,
          launchId: launched,
          contact: {
            contactId: contactId('car-contact'),
            point: vehicle.position,
            impacts: [],
          },
        },
      ],
    });
    const result = e.step(
      {
        snapshot: withFlight(1, ['white', 'green']),
        step: { durationMs: durationMs(20) },
        intents: [],
      },
      catalog(),
    );
    const before = initial.vehicles.find(
        (v) => v.vehicleId === vehicle.vehicleId,
      )!,
      after = result.snapshot.vehicles.find(
        (v) => v.vehicleId === vehicle.vehicleId,
      )!;
    expect(after.launchId).toBe(launched);
    expect(after.position).not.toEqual(before.position);
    expect(result.snapshot.actors.some((a) => a.actorId === 'blue')).toBe(
      false,
    );
  } finally {
    e.dispose();
  }
});
test('invalid residency does not prune valid state or prevent a corrected retry', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  try {
    const valid = snapshot(0),
      before = e.commit({ snapshot: valid, events: [] });
    for (const ids of [
      ['white', 'white'],
      ['white', 'unknown'],
    ])
      expect(() =>
        e.commit({
          snapshot: { ...valid, residentActorIds: ids.map(actorId) },
          events: [],
        }),
      ).toThrow();
    expect(e.commit({ snapshot: valid, events: [] })).toEqual(before);
  } finally {
    e.dispose();
  }
});

test('explicit mode cannot downgrade and rejected stale authority cannot poison a valid retry', () => {
  const e = createSpatialEngine(run, createParisStreetLayout());
  try {
    const early = snapshot(0, ['white']),
      current = snapshot(1, ['white', 'blue']);
    e.commit({ snapshot: early, events: [] });
    const accepted = e.commit({ snapshot: current, events: [] });
    expect(() =>
      e.commit({
        snapshot: state(2, { actors: roster }),
        events: [],
      }),
    ).toThrow();
    expect(() => e.commit({ snapshot: early, events: [] })).toThrow();
    expect(() =>
      e.commit({
        snapshot: { ...current, residentActorIds: [actorId('white')] },
        events: [],
      }),
    ).toThrow();
    expect(e.commit({ snapshot: current, events: [] })).toEqual(accepted);
    const advancing = {
      ...current,
      revision: current.revision + 1,
      clocks: {
        ...current.clocks,
        presentationTimeMs: presentationTimeMs(
          current.clocks.presentationTimeMs + 100,
        ),
      },
    };
    expect(e.commit({ snapshot: advancing, events: [] })).toEqual(accepted);
    expect(() => e.commit({ snapshot: current, events: [] })).toThrow();
    expect(e.commit({ snapshot: advancing, events: [] })).toEqual(accepted);
  } finally {
    e.dispose();
  }
});

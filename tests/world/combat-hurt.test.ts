import { afterEach, expect, test, vi } from 'vitest';
import {
  attackActivationId,
  clipId,
  durationMs,
  gameTimeMs,
  impactId,
  MOTION_SPACE,
} from '../../src/contracts';
import type { ActorTrajectory } from '../../src/world/contact-candidates';
import { actor, run } from './fixtures';

function trajectories(): ActorTrajectory[] {
  return (['white', 'blue'] as const).map((color, index) => {
    const position = { x: 0, y: 0, z: index * 2 };
    return {
      state: {
        ...actor(color),
        attack: index
          ? null
          : {
              activationId: attackActivationId('attack'),
              clipId: clipId('kick'),
              category: 'kick' as const,
              startedAt: gameTimeMs(0),
              consumedImpacts: [],
              impactBindings: [
                { impactIndex: 0, impactId: impactId('impact') },
              ],
            },
      },
      actor: {
        actorId: actor(color).actorId,
        position,
        facing: { x: 0, y: 0, z: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle' as const,
      },
      path: [
        { at: 0, position },
        { at: 10, position },
        { at: 20, position },
      ],
      sample: index
        ? undefined
        : {
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
                from: {
                  kind: 'sphere' as const,
                  center: { x: 0, y: 1, z: 0 },
                  radiusM: 0.2,
                },
                to: {
                  kind: 'sphere' as const,
                  center: { x: 0, y: 1, z: 3 },
                  radiusM: 0.2,
                },
              },
            ],
          },
    };
  });
}
afterEach(() => {
  vi.doUnmock('../../src/world/character-motor');
  vi.doUnmock('../../src/world/combat-hurt');
  vi.resetModules();
});

test('combat does not consult the navigation and vehicle body query', async () => {
  vi.doMock('../../src/world/character-motor', async (original) => ({
    ...(await original<object>()),
    body: () => {
      throw new Error('navigation body must not serve combat');
    },
  }));
  const { combatContacts } = await import('../../src/world/contact-candidates');
  const result = combatContacts(run, trajectories());
  expect(result.length).toBeGreaterThan(0);
  expect(result.every((c) => c.kind === 'body-hit')).toBe(true);
});

test('hurt capsule is exactly the legacy body for translated and elevated positions', async () => {
  const { body } = await import('../../src/world/character-motor');
  const { combatHurt } = await import('../../src/world/combat-hurt');
  for (const x of [-100, -0.35, -0, 0, 0.001, 12.5])
    for (const y of [-10, 0, 0.35, 1.5, 100])
      for (const z of [-100, -0, 0, 0.01, 100]) {
        const position = Object.freeze({ x, y, z });
        expect(combatHurt(position)).toStrictEqual(body(position));
      }
});

test('complete candidates match legacy query across bends, facing, misses and consumed impacts', async () => {
  const { body } = await import('../../src/world/character-motor');
  const scenarios = Array.from({ length: 36 }, (_, i) =>
    trajectories().map((t, j) => ({
      ...t,
      state: {
        ...t.state,
        attack: t.state.attack && {
          ...t.state.attack,
          consumedImpacts: i % 6 === 5 ? [impactId('impact')] : [],
        },
      },
      actor: { ...t.actor, facing: { x: Math.sin(i), y: 0, z: Math.cos(i) } },
      path: t.path.map((key, k) => ({
        ...key,
        position: {
          x: ((i % 3) - 1) * j + (k === 1 ? 0.15 : 0),
          y: (i % 4) * 0.25,
          z: key.position.z + (k === 1 ? -0.3 : 0),
        },
      })),
    })),
  );
  // Substituting only the old query recreates the pre-seam algorithm: no
  // candidate sorting, interval partitioning, point or ID normalization.
  vi.doMock('../../src/world/combat-hurt', () => ({ combatHurt: body }));
  const legacy = await import('../../src/world/contact-candidates');
  const expected = scenarios.map((actors) =>
    legacy.combatContacts(run, actors),
  );
  vi.doUnmock('../../src/world/combat-hurt');
  vi.resetModules();
  const current = await import('../../src/world/contact-candidates');
  expect(
    scenarios.map((actors) => current.combatContacts(run, actors)),
  ).toStrictEqual(expected);
  expect(expected.some((contacts) => contacts.length > 0)).toBe(true);
  expect(expected.some((contacts) => contacts.length === 0)).toBe(true);
});

test('legacy and separated candidates produce identical HP with duplicate interval contacts', async () => {
  const { attack, setup, step } = await import('../core/fixtures/scenarios');
  const { body } = await import('../../src/world/character-motor');
  const evaluate = async (withRegions = false) => {
    const { combatContacts } = await import(
      '../../src/world/contact-candidates'
    );
    const core = setup();
    attack(core, 'white', 'kick');
    const snapshot = core.read();
    const actors = trajectories().map((t, i) => {
      const state = snapshot.actors.find(
        (a) => a.color === (i ? 'blue' : 'white'),
      );
      if (!state) throw new Error('Missing fixture actor');
      if (t.sample && !state.attack) throw new Error('Missing fixture attack');
      return {
        ...t,
        state,
        actor: { ...t.actor, actorId: state.actorId },
        path: t.path.map((key) => ({ ...key, at: key.at / 2 })),
        sample: t.sample && {
          ...t.sample,
          clipId: state.attack?.clipId ?? t.sample.clipId,
          toMs: durationMs(10),
          hitVolumeSegments: t.sample.hitVolumeSegments.map((h) => ({
            ...h,
            toMs: durationMs(10),
            activeWindow: { startMs: durationMs(0), endMs: durationMs(10) },
          })),
        },
      };
    });
    const candidates = combatContacts(
      snapshot.runId,
      actors,
      withRegions
        ? actors.map((target) => ({
            runId: snapshot.runId,
            target,
            sourceId: 'synthetic-body',
            poseId: 'synthetic-static',
            space: 'actor-local-metres' as const,
            interpolation: 'piecewise-linear' as const,
            segments: ['head', 'body'].map((partId) => ({
              partId,
              from: 0,
              to: 10,
              start: body({ x: 0, y: 0, z: 0 }),
              end: body({ x: 0, y: 0, z: 0 }),
            })),
          }))
        : undefined,
    );
    expect(candidates.length).toBeGreaterThan(1);
    const output = step(core, () => [...candidates, ...candidates].reverse());
    expect(output.events.filter((e) => e.type === 'HpChanged')).toHaveLength(1);
    expect(output.snapshot.actors.find((a) => a.color === 'blue')?.hp).toBe(
      400,
    );
    return output;
  };
  vi.doMock('../../src/world/combat-hurt', () => ({ combatHurt: body }));
  vi.resetModules();
  const legacy = await evaluate();
  vi.doUnmock('../../src/world/combat-hurt');
  vi.resetModules();
  expect(await evaluate()).toStrictEqual(legacy);
  expect(await evaluate(true)).toStrictEqual(legacy);
});

test('motor and launched car results are independent of the melee hurt query', async () => {
  const { contactId, domainEventId, launchId, vehicleId } = await import(
    '../../src/contracts'
  );
  const { state } = await import('./fixtures');
  const evaluate = async () => {
    const { createVehicleSystem } = await import(
      '../../src/world/vehicle-system'
    );
    const { stepCharacter, toBox } = await import(
      '../../src/world/character-motor'
    );
    const { createParisStreetLayout } = await import(
      '../../src/world/street-layout'
    );
    const actors = trajectories();
    const owner = actors[0];
    if (!owner) throw new Error('Missing fixture owner');
    const car = vehicleId('car'),
      launch = launchId('launch');
    const layout = {
      ...createParisStreetLayout(),
      objects: [],
      vehicles: [
        {
          vehicleId: car,
          position: { x: 0, y: 0, z: 1 },
          halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
        },
      ],
    };
    const motor = stepCharacter(
      owner.actor,
      actor('white'),
      0,
      20,
      { x: 1, y: 0, z: 1 },
      true,
      undefined,
      0,
      layout,
      [toBox({ x: 1, y: 1, z: 1 }, { x: 0.1, y: 1, z: 1 })],
    );
    const vehicles = createVehicleSystem(run, layout);
    const snapshot = state(0, {
      world: {
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
      },
    });
    vehicles.commit(
      {
        snapshot,
        events: [
          {
            type: 'VehicleLaunchApproved',
            runId: run,
            eventId: domainEventId('launch-event'),
            sequence: 1,
            at: gameTimeMs(0),
            actorId: owner.state.actorId,
            vehicleId: car,
            launchId: launch,
            contact: {
              contactId: contactId('kick-car'),
              point: { x: 0, y: 1, z: 0 },
              impacts: [],
            },
          },
        ],
      },
      new Map(actors.map((t) => [t.state.actorId, t.actor])),
    );
    const contacts = vehicles.step(snapshot, 0, 20, actors);
    expect(contacts.some((c) => c.kind === 'vehicle-contact')).toBe(true);
    expect(motor.actor.position.y).toBeGreaterThan(0);
    return { motor, contacts };
  };
  const baseline = await evaluate();
  vi.doMock('../../src/world/combat-hurt', () => ({
    combatHurt: () => {
      throw new Error('Melee query must not serve navigation or vehicles');
    },
  }));
  vi.resetModules();
  expect(await evaluate()).toStrictEqual(baseline);
});

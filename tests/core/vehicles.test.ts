import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import {
  vehicleId,
  worldObjectId,
  type SpatialCandidate,
} from '../../src/contracts';
import { createCore } from '../../src/core/createCore';
import {
  advanceCore,
  attack,
  envelope,
  fixtureCatalog,
  reference,
  run,
  step,
} from './fixtures/scenarios';
const car = vehicleId('car'),
  shop = worldObjectId('shop');
function setup() {
  const core = createCore(
    { runId: run, seed: 1 },
    {
      ...fixtureCatalog(),
      world: {
        vehicles: [{ vehicleId: car, hp: 100 }],
        objects: [{ objectId: shop, durability: 100 }],
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}
test('car launch loses20, deals50 once, no waiting enemy hit, and collision destruction deduplicates', () => {
  const core = setup();
  attack(core, 'white', 'kick');
  const source = reference(core);
  const out = step(core, (at) => [
    {
      ...envelope(at, 'launch'),
      kind: 'vehicle-launch',
      source,
      vehicleId: car,
    },
    {
      ...envelope(at, 'duplicate'),
      kind: 'vehicle-launch',
      source,
      vehicleId: car,
    },
  ]);
  const launches = out.events.filter((e) => e.type === 'VehicleLaunchApproved');
  expect(launches).toHaveLength(1);
  const launchId = requireValue(launches[0]).launchId;
  expect(core.read().world.vehicles[0]?.hp).toBe(80);
  const targetActorId = requireValue(core.read().currentOpponentId);
  const waiting = requireValue(
    core.read().actors.find((a) => a.color === 'green'),
  ).actorId;
  const contacts = (at: number): SpatialCandidate[] => [
    {
      ...envelope(at, `car:${at}`),
      kind: 'vehicle-contact',
      launchId,
      vehicleId: car,
      targetActorId,
    },
    {
      ...envelope(at, `wait:${at}`),
      kind: 'vehicle-contact',
      launchId,
      vehicleId: car,
      targetActorId: waiting,
    },
    {
      ...envelope(at, `shop:${at}`),
      kind: 'destruction',
      launchId,
      sourceActorId: source.actorId,
      targetId: shop,
      contactSpeedMps: 6,
    },
  ];
  step(core, contacts);
  step(core, contacts);
  expect(
    requireValue(core.read().actors.find((a) => a.actorId === targetActorId))
      .hp,
  ).toBe(450);
  expect(
    requireValue(core.read().actors.find((a) => a.actorId === waiting)).hp,
  ).toBe(500);
  expect(core.read().world.objects[0]?.durability).toBe(80);
});
test('fifth launch breaks car, cannot relaunch; direct kick-car destruction is not double charged', () => {
  const core = setup();
  for (let n = 0; n < 6; n++) {
    advanceCore(core, 500);
    attack(core, 'white', 'kick');
    const source = reference(core);
    const out = step(core, (at) => [
      {
        ...envelope(at, `launch${n}`),
        kind: 'vehicle-launch',
        source,
        vehicleId: car,
      },
      {
        ...envelope(at, `direct${n}`),
        kind: 'destruction',
        source,
        sourceActorId: source.actorId,
        targetId: car,
        launchId: null,
        contactSpeedMps: 5,
      },
    ]);
    expect(
      out.events.filter((e) => e.type === 'VehicleLaunchApproved'),
    ).toHaveLength(n < 5 ? 1 : 0);
  }
  expect(core.read().world.vehicles[0]).toMatchObject({
    hp: 0,
    broken: true,
    canLaunch: false,
  });
});
test('validated direct strike only, finite fixed denominator, no residual destruction', () => {
  const core = setup();
  attack(core);
  const source = reference(core);
  step(core, (at) => [
    {
      ...envelope(at, 'missing'),
      kind: 'destruction',
      sourceActorId: source.actorId,
      targetId: shop,
      launchId: null,
      contactSpeedMps: 4,
    },
    {
      ...envelope(at, 'strike'),
      kind: 'destruction',
      source,
      sourceActorId: source.actorId,
      targetId: shop,
      launchId: null,
      contactSpeedMps: 4,
    },
    {
      ...envelope(at, 'repeat'),
      kind: 'destruction',
      source,
      sourceActorId: source.actorId,
      targetId: shop,
      launchId: null,
      contactSpeedMps: 4,
    },
  ]);
  expect(core.read().world.objects[0]).toMatchObject({
    durability: 0,
    destroyed: true,
  });
});
test('simultaneous body wins over car regardless of contact IDs and input order', () => {
  for (const reverse of [false, true]) {
    const core = setup();
    attack(core, 'white', 'kick');
    const source = reference(core),
      targetActorId = requireValue(core.read().currentOpponentId);
    const output = step(core, (at) => {
      const list: SpatialCandidate[] = [
        {
          ...envelope(at, 'aaa-launch'),
          kind: 'vehicle-launch',
          source,
          vehicleId: car,
        },
        {
          ...envelope(at, 'zzz-body'),
          kind: 'body-hit',
          source,
          targetActorId,
        },
      ];
      return reverse ? list.reverse() : list;
    });
    expect(requireValue(core.read().actors[1]).hp).toBe(400);
    expect(requireValue(core.read().world.vehicles[0]).hp).toBe(100);
    expect(output.events.some((e) => e.type === 'VehicleLaunchApproved')).toBe(
      false,
    );
  }
});
test('street overlap tie uses stable target IDs and consumes one impact', () => {
  const another = worldObjectId('aaa-shop');
  const core = createCore(
    { runId: run, seed: 1 },
    {
      ...fixtureCatalog(),
      world: {
        vehicles: [],
        objects: [
          { objectId: shop, durability: 100 },
          { objectId: another, durability: 100 },
        ],
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  attack(core);
  const source = reference(core);
  step(core, (at) => [
    {
      ...envelope(at, 'aaa-contact'),
      kind: 'destruction',
      source,
      sourceActorId: source.actorId,
      targetId: shop,
      launchId: null,
      contactSpeedMps: 4,
    },
    {
      ...envelope(at, 'zzz-contact'),
      kind: 'destruction',
      source,
      sourceActorId: source.actorId,
      targetId: another,
      launchId: null,
      contactSpeedMps: 4,
    },
  ]);
  expect(
    requireValue(core.read().world.objects.find((o) => o.objectId === another))
      .durability,
  ).toBe(0);
  expect(
    requireValue(core.read().world.objects.find((o) => o.objectId === shop))
      .durability,
  ).toBe(100);
});

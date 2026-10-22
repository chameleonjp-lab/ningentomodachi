import { expect, test } from 'vitest';
import {
  runId,
  vehicleId,
  worldObjectId,
  actorId,
  attackActivationId,
} from '../../src/contracts';
import { createWorldLedger } from '../../src/core/worldLedger';
test('attribution uses total initial durability and clamps actual repeated loss', () => {
  const car = vehicleId('car'),
    shop = worldObjectId('shop');
  const world = createWorldLedger(runId('run'), {
    vehicles: [{ vehicleId: car, hp: 100 }],
    objects: [{ objectId: shop, durability: 300 }],
  });
  expect(world.damage(shop, 500, true)).toBe(300);
  expect(world.damage(shop, 500, true)).toBe(0);
  expect(world.rates()).toMatchObject({
    playerCausedDestructionRate: 0.75,
    streetRate: 1,
    vehicleRate: 0,
  });
  world.launch(car, attackActivationId('attack'), actorId('white'));
  expect(world.rates().playerCausedDestructionRate).toBe(0.8);
});
test('zero denominator finite and enemy loss does not become player attribution', () => {
  expect(
    createWorldLedger(runId('empty'), { vehicles: [], objects: [] }).rates(),
  ).toMatchObject({
    streetRate: 0,
    vehicleRate: 0,
    playerCausedDestructionRate: 0,
  });
  const shop = worldObjectId('shop');
  const world = createWorldLedger(runId('run'), {
    vehicles: [],
    objects: [{ objectId: shop, durability: 100 }],
  });
  world.damage(shop, 100, false);
  expect(world.rates()).toMatchObject({
    streetRate: 1,
    playerCausedDestructionRate: 0,
  });
});

test('overflowing initial durability is rejected rather than producing non-finite rates', () => {
  expect(() =>
    createWorldLedger(runId('overflow'), {
      vehicles: [{ vehicleId: vehicleId('car'), hp: Number.MAX_VALUE }],
      objects: [
        { objectId: worldObjectId('shop'), durability: Number.MAX_VALUE },
      ],
    }),
  ).toThrow();
});

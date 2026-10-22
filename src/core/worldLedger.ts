import {
  launchId,
  type ActorId,
  type AttackActivationId,
  type LaunchId,
  type RunId,
  type VehicleId,
  type WorldObjectId,
  type WorldState,
} from '../contracts';
import { finite, PROVISIONAL_TUNING } from './rules';
export interface WorldSeed {
  readonly vehicles: readonly {
    readonly vehicleId: VehicleId;
    readonly hp: number;
  }[];
  readonly objects: readonly {
    readonly objectId: WorldObjectId;
    readonly durability: number;
  }[];
}
export function createWorldLedger(run: RunId, seed: WorldSeed) {
  const vehicles = seed.vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    hp: finite(v.hp, 'vehicle hp'),
    maxHp: v.hp,
    broken: v.hp === 0,
    canLaunch: v.hp > 0,
    activeLaunchId: null as LaunchId | null,
  }));
  const objects = seed.objects.map((o) => ({
    objectId: o.objectId,
    durability: finite(o.durability, 'durability'),
    maxDurability: o.durability,
    destroyed: o.durability === 0,
  }));
  if (
    new Set([
      ...vehicles.map((v) => v.vehicleId),
      ...objects.map((o) => o.objectId),
    ]).size !==
    vehicles.length + objects.length
  )
    throw new Error('World IDs must be unique');
  const launches = new Map<
    LaunchId,
    { actorId: ActorId; vehicleId: VehicleId }
  >();
  const launched = new Set<string>();
  const contacts = new Set<string>();
  let serial = 0;
  let playerLoss = 0;
  const vehicleTotal = vehicles.reduce((s, v) => s + v.maxHp, 0),
    streetTotal = objects.reduce((s, o) => s + o.maxDurability, 0);
  finite(vehicleTotal + streetTotal, 'total initial durability');
  function damage(
    id: VehicleId | WorldObjectId,
    amount: number,
    player: boolean,
  ) {
    finite(amount, 'loss');
    const v = vehicles.find((v) => v.vehicleId === id);
    const o = objects.find((o) => o.objectId === id);
    let loss = 0;
    if (v) {
      loss = Math.min(v.hp, amount);
      v.hp -= loss;
      v.broken = v.hp === 0;
      v.canLaunch = !v.broken;
    } else if (o) {
      loss = Math.min(o.durability, amount);
      o.durability -= loss;
      o.destroyed = o.durability === 0;
    }
    if (player) playerLoss += loss;
    return loss;
  }
  return {
    hasTarget(id: VehicleId | WorldObjectId) {
      return (
        vehicles.some((v) => v.vehicleId === id) ||
        objects.some((o) => o.objectId === id)
      );
    },
    read(): WorldState {
      return {
        vehicles: vehicles.map((v) => ({ ...v })),
        objects: objects.map((o) => ({ ...o })),
      };
    },
    launch(
      vehicleId: VehicleId,
      activation: AttackActivationId,
      actorId: ActorId,
    ) {
      const v = vehicles.find((v) => v.vehicleId === vehicleId);
      const key = JSON.stringify([activation, vehicleId]);
      if (!v?.canLaunch || launched.has(key)) return null;
      launched.add(key);
      const id = launchId(`${run}:launch:${++serial}`);
      v.activeLaunchId = id;
      launches.set(id, { actorId, vehicleId });
      const actualLoss = damage(
        vehicleId,
        PROVISIONAL_TUNING.vehicleLaunchLoss,
        true,
      );
      return { launchId: id, actualLoss };
    },
    source(id: LaunchId, vehicleId?: VehicleId) {
      const value = launches.get(id);
      if (
        !value ||
        (vehicleId !== undefined && value.vehicleId !== vehicleId) ||
        vehicles.find((v) => v.vehicleId === value.vehicleId)
          ?.activeLaunchId !== id
      )
        return null;
      return value;
    },
    once(key: readonly string[]) {
      const id = JSON.stringify(key);
      if (contacts.has(id)) return false;
      contacts.add(id);
      return true;
    },
    damage,
    rates() {
      return {
        vehicleRate: vehicleTotal
          ? 1 - vehicles.reduce((s, v) => s + v.hp, 0) / vehicleTotal
          : 0,
        streetRate: streetTotal
          ? 1 - objects.reduce((s, o) => s + o.durability, 0) / streetTotal
          : 0,
        playerLoss,
        playerCausedDestructionRate:
          vehicleTotal + streetTotal
            ? Math.min(1, playerLoss / (vehicleTotal + streetTotal))
            : 0,
      };
    },
  };
}

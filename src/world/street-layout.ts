import {
  type ActorColor,
  type Vector3,
  type VehicleId,
  vehicleId,
  type WorldObjectId,
  worldObjectId,
} from '../contracts';
export interface StreetLayout {
  readonly actorSpawns: Readonly<Record<ActorColor, Vector3>>;
  readonly vehicles: readonly {
    readonly vehicleId: VehicleId;
    readonly position: Vector3;
    readonly halfExtents: Vector3;
  }[];
  readonly objects: readonly {
    readonly objectId: WorldObjectId;
    readonly position: Vector3;
    readonly halfExtents: Vector3;
  }[];
  readonly bounds: { readonly min: Vector3; readonly max: Vector3 };
}
/** Geometry only. A seeds and owns durability from these stable IDs. */
export function createParisStreetLayout(): StreetLayout {
  const actorSpawns = {
    white: { x: 0, y: 0, z: 0 },
    blue: { x: 0, y: 0, z: 8 },
    green: { x: 0, y: 0, z: 24 },
    yellow: { x: 0, y: 0, z: 40 },
    black: { x: 0, y: 0, z: 56 },
  };
  const vehicles = [0, 1, 2, 3].map((i) => ({
    vehicleId: vehicleId(`paris:car:${i}`),
    position: { x: i % 2 ? -3 : 3, y: 0, z: 5 + i * 16 },
    halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
  }));
  const objects = [-1, 1].flatMap((side) =>
    [0, 1, 2, 3].map((i) => ({
      objectId: worldObjectId(`paris:shop:${side < 0 ? 'left' : 'right'}:${i}`),
      position: { x: side * 9, y: 4, z: 8 + i * 16 },
      halfExtents: { x: 2, y: 4, z: 7.5 },
    })),
  );
  return {
    actorSpawns,
    vehicles,
    objects,
    bounds: { min: { x: -6.5, y: 0, z: -6 }, max: { x: 6.5, y: 12, z: 68 } },
  };
}

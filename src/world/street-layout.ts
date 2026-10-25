import {
  type ActorColor,
  type Vector3,
  type VehicleId,
  vehicleId,
  type WorldObjectId,
  worldObjectId,
} from '../contracts';
export interface BattleStage {
  readonly mode: 'four-battle';
  readonly viewDepth: Vector3;
  readonly framingHeightM: number;
  readonly backdropMinX: number;
}
export interface StreetLayout {
  readonly battleStage?: BattleStage;
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

/** Combat geometry is separate from the retained legacy street layout. */
export function createParisBattleLayout(): StreetLayout {
  const angle = (12 * Math.PI) / 180;
  return {
    actorSpawns: {
      white: { x: 0, y: 0, z: -1.4 },
      blue: { x: 0, y: 0, z: 1.4 },
      green: { x: 0, y: 0, z: 1.4 },
      yellow: { x: 0, y: 0, z: 1.4 },
      black: { x: 0, y: 0, z: 1.4 },
    },
    vehicles: [],
    objects: [],
    bounds: { min: { x: -2, y: 0, z: -5 }, max: { x: 2, y: 12, z: 5 } },
    battleStage: {
      mode: 'four-battle',
      viewDepth: { x: Math.cos(angle), y: 0, z: -Math.sin(angle) },
      framingHeightM: 2.1,
      backdropMinX: 7,
    },
  };
}

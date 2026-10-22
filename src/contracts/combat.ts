import type { ActiveRealTimeMs, GameTimeMs } from './clock';
import type {
  ActorId,
  AttackActivationId,
  ClipId,
  ImpactId,
  LaunchId,
  WorldObjectId,
  VehicleId,
} from './ids';
import type { AttackCategory } from './motion';
export type ActorColor = 'white' | 'blue' | 'green' | 'yellow' | 'black';
export interface HeatState {
  readonly amount: number;
  readonly capacity: number;
  readonly lockedUntil: ActiveRealTimeMs | null;
}
export interface ImpactBinding {
  readonly impactIndex: number;
  readonly impactId: ImpactId;
}
export type ActionPermission =
  | { readonly allowed: true; readonly reason: null }
  | {
      readonly allowed: false;
      readonly reason:
        | 'not-running'
        | 'busy'
        | 'cooling-lock'
        | 'defeated'
        | 'unavailable';
    };
export interface AttackState {
  readonly activationId: AttackActivationId;
  readonly clipId: ClipId;
  readonly category: AttackCategory;
  readonly startedAt: GameTimeMs;
  readonly consumedImpacts: readonly ImpactId[];
  /** A-issued mapping; B/C must never invent activation-scoped impact IDs. */
  readonly impactBindings: readonly ImpactBinding[];
}
export interface ActorState {
  readonly actorId: ActorId;
  readonly color: ActorColor;
  readonly hp: number;
  readonly maxHp: number;
  readonly heat: HeatState;
  readonly attack: AttackState | null;
  readonly defeated: boolean;
  /** Authoritative Core permissions, not UI-derived heat thresholds. */
  readonly actions: {
    readonly punch: ActionPermission;
    readonly kick: ActionPermission;
    readonly jump: ActionPermission;
    readonly move: ActionPermission;
  };
}
export interface MoveSet {
  readonly punches: readonly ClipId[];
  readonly kicks: readonly ClipId[];
}
export type DamageCause =
  | {
      readonly kind: 'attack';
      readonly actorId: ActorId;
      readonly activationId: AttackActivationId;
      readonly impactId: ImpactId;
      readonly category: AttackCategory;
    }
  | {
      readonly kind: 'clash';
      readonly actorId: ActorId;
      readonly activationId: AttackActivationId;
      readonly impactId: ImpactId;
      readonly category: AttackCategory;
    }
  | {
      readonly kind: 'vehicle';
      readonly actorId: ActorId;
      readonly vehicleId: VehicleId;
      readonly launchId: LaunchId;
    };
export interface ScoreBreakdown {
  readonly defeatedEnemies: number;
  readonly remainingHp: number;
  readonly survivalTime: GameTimeMs;
  readonly clearTime: GameTimeMs | null;
  readonly destructionPenalty: number;
  readonly streetDestructionRate: number;
  readonly vehicleDestructionRate: number;
  readonly total: number;
}
export interface TerminalResult {
  readonly outcome: 'clear' | 'defeat';
  readonly finalizedAt: GameTimeMs;
  readonly score: ScoreBreakdown;
}

/** A owns durability and launch permission. C owns pose/velocity observations only. */
export interface WorldState {
  readonly vehicles: readonly {
    readonly vehicleId: VehicleId;
    readonly hp: number;
    readonly maxHp: number;
    readonly broken: boolean;
    readonly canLaunch: boolean;
    readonly activeLaunchId: LaunchId | null;
  }[];
  readonly objects: readonly {
    readonly objectId: WorldObjectId;
    readonly durability: number;
    readonly maxDurability: number;
    readonly destroyed: boolean;
  }[];
}

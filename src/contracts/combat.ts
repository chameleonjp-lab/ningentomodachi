import type {
  FightingAttackState,
  FightingClock,
  FightingCombatantState,
  FightingPoseContext,
  FightingPoseHold,
} from './fighting';
import type {
  ActiveRealTimeMs,
  DurationMs,
  GameTimeMs,
  PresentationTimeMs,
} from './clock';
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
  /** Absent means the unchanged legacy path, not an implicit v3 attack. */
  readonly fighting?: FightingAttackState;
  readonly activationId: AttackActivationId;
  readonly clipId: ClipId;
  readonly category: AttackCategory;
  readonly startedAt: GameTimeMs;
  readonly consumedImpacts: readonly ImpactId[];
  /** A-issued mapping; B/C must never invent activation-scoped impact IDs. */
  readonly impactBindings: readonly ImpactBinding[];
}
export interface ActorState {
  readonly fightingPose?: FightingPoseContext;
  /** Visual-only hold: never adds or removes accepted blockstun defense. */
  readonly fightingPoseHold?: FightingPoseHold;
  readonly fighting?: FightingCombatantState;
  /** Sole delivery field for planned beginStep and accepted completeStep motion slices. */
  readonly fightingClock?: FightingClock;
  readonly actorId: ActorId;
  readonly color: ActorColor;
  readonly hp: number;
  readonly maxHp: number;
  readonly heat: HeatState;
  readonly attack: AttackState | null;
  readonly defeated: boolean;
  /** Core-owned hold. Omitted legacy fixture values mean standing. */
  readonly crouching?: boolean;
  /** Durable A-owned visual choice. Optional only for pre-P1 fixtures. Vehicle -> kick is provisional.
   * B seeks the shared presentation clock, applies the slow rate until its duration, then 1.0,
   * clamps to its mapped clip duration and holds the final pose. No render callback changes HP. */
  readonly defeatPresentation?: {
    readonly category: AttackCategory;
    readonly startedAt: PresentationTimeMs;
    readonly slowDurationMs: DurationMs;
    readonly playbackRate: 0.25;
  };
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
  /** P1 Core always provides authoritative signed contributions. Optional for P0 fixtures only.
   * Sum equals total; adjustment accounts for final rounding and the nonnegative clamp. */
  readonly contributions?: {
    readonly survival: number;
    readonly defeats: number;
    readonly remainingHp: number;
    readonly clear: number;
    readonly speed: number;
    readonly destruction: number;
    readonly adjustment: number;
  };
  readonly defeatedEnemies: number;
  readonly remainingHp: number;
  readonly survivalTime: GameTimeMs;
  readonly clearTime: GameTimeMs | null;
  /** P1 always supplies actual player-caused loss / initial total car+street durability.
   * Zero initial durability yields 0. This attribution does not change total damage scoring. */
  readonly playerCausedDestructionRate?: number;
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

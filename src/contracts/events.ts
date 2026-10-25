import type { GuardHeight } from './fighting';
import type { GameTimeMs } from './clock';
import type { ActorState, DamageCause, TerminalResult } from './combat';
import type { PauseReason } from './commands';
import type {
  ActorId,
  AttackActivationId,
  BatchId,
  ClipId,
  DomainEventId,
  ImpactId,
  LaunchId,
  RunId,
  VehicleId,
  WorldObjectId,
} from './ids';
import type { ResolvedContact } from './spatial';
export interface EventEnvelope {
  /** Strictly increasing per run. Arrays are emitted in this order; IDs are opaque. */
  readonly sequence: number;
  readonly eventId: DomainEventId;
  readonly runId: RunId;
  readonly at: GameTimeMs;
}
export type GamePhase =
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'terminal'
  | 'stopped'
  | 'error';
export interface HpChanged extends EventEnvelope {
  readonly contact: ResolvedContact;
  readonly type: 'HpChanged';
  readonly actorId: ActorId;
  readonly cause: DamageCause;
  readonly maxHp: number;
  readonly beforeHp: number;
  readonly afterHp: number;
  readonly actualHpLost: number;
  readonly batchId: BatchId;
}
export interface GuardResolved extends EventEnvelope {
  readonly type: 'GuardResolved';
  readonly actorId: ActorId;
  readonly sourceActorId: ActorId;
  readonly activationId: AttackActivationId;
  readonly impactId: ImpactId;
  readonly contact: ResolvedContact;
  readonly height: GuardHeight;
}
/** GuardResolved describes accepted physical contact, never input success or HP loss. */
export type DomainEvent =
  | HpChanged
  | GuardResolved
  | (EventEnvelope &
      (
        | {
            readonly type: 'ProgressChanged';
            readonly phase: GamePhase;
            readonly pauseReasons: readonly PauseReason[];
          }
        | {
            readonly type: 'AttackAccepted';
            readonly actorId: ActorId;
            readonly activationId: AttackActivationId;
            readonly clipId: ClipId;
          }
        | {
            readonly type: 'AttackRejected';
            readonly actorId: ActorId;
            readonly reason:
              | 'not-running'
              | 'not-implemented'
              | 'locked'
              | 'invalid-command';
          }
        | {
            readonly type: 'ClashResolved';
            readonly contact: ResolvedContact;
            readonly firstActorId: ActorId;
            readonly secondActorId: ActorId;
            readonly difference: number;
            readonly batchId: BatchId;
          }
        | {
            readonly type: 'Healed';
            readonly actorId: ActorId;
            readonly beforeHp: number;
            readonly afterHp: number;
            readonly actualHpGained: number;
            readonly maxHp: number;
            readonly batchId: BatchId;
          }
        | {
            readonly type: 'OpponentChanged';
            readonly previousActorId: ActorId | null;
            readonly currentActorId: ActorId | null;
          }
        | {
            readonly type: 'HeatChanged';
            readonly actorId: ActorId;
            readonly heat: ActorState['heat'];
          }
        | {
            readonly type: 'ActorDefeated';
            readonly actorId: ActorId;
            readonly batchId: BatchId;
          }
        | {
            readonly type: 'VehicleLaunchApproved';
            readonly contact: ResolvedContact;
            readonly actorId: ActorId;
            readonly vehicleId: VehicleId;
            readonly launchId: LaunchId;
          }
        | {
            readonly type: 'DestructionCounted';
            readonly targetId: VehicleId | WorldObjectId;
            readonly actualLoss: number;
          }
        | { readonly type: 'ResultFinalized'; readonly result: TerminalResult }
        | { readonly type: 'FoundationError'; readonly message: string }
      ));

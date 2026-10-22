import type { GameTimeMs, Tick } from './clock';
import type {
  ActorId,
  AttackActivationId,
  ContactId,
  DomainEventId,
  ImpactId,
  LaunchId,
  RunId,
  VehicleId,
  WorldObjectId,
} from './ids';
import type { Vector3 } from './motion';
import type { ActorPoseStamp } from './pose';
export interface SpatialActor {
  readonly actorId: ActorId;
  /** C-owned physical anchor. B posture and defeated-only presentation offsets do not
   * redefine it or turn C's fixed physical hurt proxy into skeletal mesh collision. */
  readonly position: Vector3;
  readonly facing: Vector3;
  readonly velocity: Vector3;
  readonly grounded: boolean;
  readonly locomotion: 'idle' | 'walk' | 'run' | 'jump';
  /** Future qualified v1 mode requires this after readiness. Loading/legacy may omit.
   * Declaration only: current runtime remains legacy and produces no pose stamps. */
  readonly pose?: ActorPoseStamp;
}
export interface SpatialVehicle {
  readonly vehicleId: VehicleId;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly grounded: boolean;
  readonly launchId: LaunchId | null;
}
export interface SpatialSnapshot {
  readonly tick: Tick;
  readonly runId: RunId;
  readonly actors: readonly SpatialActor[];
  readonly vehicles: readonly SpatialVehicle[];
}
export interface ImpactReference {
  readonly actorId: ActorId;
  readonly activationId: AttackActivationId;
  readonly impactId: ImpactId;
}
interface ContactEnvelope {
  readonly runId: RunId;
  readonly contactId: ContactId;
  readonly at: GameTimeMs;
  readonly interval: { readonly from: GameTimeMs; readonly to: GameTimeMs };
  readonly point: Vector3;
  readonly evidence: 'swept-shape' | 'overlap';
}
/** Candidates never contain trusted damage or permission to change HP. */
export type SpatialCandidate = ContactEnvelope &
  (
    | {
        readonly kind: 'body-hit';
        readonly source: ImpactReference;
        readonly targetActorId: ActorId;
      }
    | {
        readonly kind: 'clash';
        readonly first: ImpactReference;
        readonly second: ImpactReference;
      }
    | {
        readonly kind: 'vehicle-launch';
        readonly source: ImpactReference;
        readonly vehicleId: VehicleId;
      }
    | {
        readonly kind: 'vehicle-contact';
        readonly launchId: LaunchId;
        readonly vehicleId: VehicleId;
        readonly targetActorId: ActorId;
      }
    | {
        readonly kind: 'destruction';
        readonly sourceActorId: ActorId;
        /** Required by Core for direct (launchId:null) strike validation; no trusted damage. */
        readonly source?: ImpactReference;
        readonly targetId: VehicleId | WorldObjectId;
        readonly launchId: LaunchId | null;
        readonly contactSpeedMps: number;
      }
  );
export interface Projection {
  readonly eventId: DomainEventId;
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly viewportRevision: number;
  readonly visibility: 'visible' | 'offscreen' | 'unprojectable';
  /** Root-local CSS pixels, not device pixels. DOM client anchors subtract the shared
   * viewport offsets. Null when unavailable, never a fabricated central hit point. */
  readonly cssPoint: { readonly x: number; readonly y: number } | null;
}

/** Selected by A from accepted candidates, never inferred from unresolved contacts by presentation. */
export interface ResolvedContact {
  readonly contactId: ContactId;
  readonly point: Vector3;
  readonly impacts: readonly ImpactReference[];
}

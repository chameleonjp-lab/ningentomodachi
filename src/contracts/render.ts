import type { PresentationTimeMs, Tick } from './clock';
import type { ActorId, RunId } from './ids';
import type { Vector3 } from './motion';

/** B-produced exact displayed bounds, after every B-owned node/pose transform but before
 * C's physical facing/translation and defeated-only presentation parent. All coordinates
 * are finite metres. Bounds are ordered on every axis; negative support is permitted.
 * The entry minimum belongs to the actual inherited t0 pose and is stable for this death,
 * including skipped-first-draw/replay. Without that pose, support is unavailable, not zero. */
export interface DefeatPoseSupportObservation {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly defeatStartedAt: PresentationTimeMs;
  readonly tick: Tick;
  readonly presentationTimeMs: PresentationTimeMs;
  readonly entryLocalMinY: number;
  readonly currentLocalBounds: {
    readonly min: Vector3;
    readonly max: Vector3;
  };
}

/** C owns the scene/camera/sole renderer and a physical transform parent for every attachment.
 * C may insert a defeated-only presentation child between that unchanged physical parent and B's
 * node. Its ground settlement uses C's ground datum and A's durable presentation clock; it never
 * changes authoritative spatial snapshots, collisions or historical hit points. C's camera follows
 * the derived visual focus when needed. Re-rendering the same snapshot is idempotent.
 * B owns the supplied model node, skeleton/mixer/materials and local death pose (ground y=0).
 * B must not compensate for world height or mutate the physical/presentation parents.
 * The composition root selects Node
 * (e.g. official engine Object3D in P1); no owner imports another owner's private types. */
export interface ActorRenderHostPort<Node> {
  readonly runId: RunId;
  /** Reject wrong/disposed run or duplicate live actor. New mounts use the current committed
   * C pose before the next draw. Detach is idempotent and never disposes B's node/resources. */
  mountActor(request: {
    readonly runId: RunId;
    readonly actorId: ActorId;
    readonly node: Node;
    /** Explicit producer capability. Absence means legacy, never bounds-qualified. */
    readonly defeatPoseSupport?: 'bounds-v1';
  }): () => void;
  /** B publishes after seeking, before C's sole draw. True means structurally valid and
   * staged for this live mounted actor/run, NOT matched to the latest commit: saved-frame
   * replay may render an older frame. False rejects invalid/unmounted/disposed/wrong-run
   * data and must be treated by B as unavailable, never success. C.render matches all
   * identity/time fields to the actual rendered CommittedFrame and durable death record.
   * For an opted-in defeated mount, missing/mismatched support throws before the scene
   * draw; prior support cannot silently substitute. Detach clears the mount's observations.
   * Optional only for legacy host compatibility; bounds-v1 producers require this method. */
  publishDefeatPoseSupport?(observation: DefeatPoseSupportObservation): boolean;
}

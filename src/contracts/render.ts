import type { ActorId, RunId } from './ids';
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
  }): () => void;
}

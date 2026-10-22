import type { ActorId, RunId } from './ids';
/** C owns the scene/camera/sole renderer and a physical transform parent for every attachment.
 * B owns the supplied model node, skeleton/mixer/materials. The composition root selects Node
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

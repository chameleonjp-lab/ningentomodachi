import type {
  ActorId,
  ActorRenderHostPort,
  RunContext,
  SpatialActor,
  Vector3,
} from '../../../src/contracts';
export interface FixtureRenderNode {
  readonly label: string;
  poseRevision: number;
  disposed: boolean;
}
/** Synthetic C attachment host, no renderer/model/engine implementation. */
export function createFixtureRenderHost(context: RunContext) {
  const attachments = new Map<
    ActorId,
    { readonly node: FixtureRenderNode; position: Vector3 | null }
  >();
  let poses: readonly SpatialActor[] = [];
  let disposed = false;
  const port: ActorRenderHostPort<FixtureRenderNode> = {
    runId: context.runId,
    mountActor: (request) => {
      if (
        disposed ||
        request.runId !== context.runId ||
        attachments.has(request.actorId)
      )
        throw new Error('Invalid or duplicate actor attachment');
      const entry = {
        node: request.node,
        position:
          poses.find((pose) => pose.actorId === request.actorId)?.position ??
          null,
      };
      attachments.set(request.actorId, entry);
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        if (attachments.get(request.actorId) === entry)
          attachments.delete(request.actorId);
      };
    },
  };
  return {
    port: Object.freeze(port),
    attachments,
    commit: (actors: readonly SpatialActor[]) => {
      poses = actors;
      for (const [id, entry] of attachments)
        entry.position =
          poses.find((pose) => pose.actorId === id)?.position ?? null;
    },
    dispose: () => {
      disposed = true;
      attachments.clear();
    },
  };
}

import { clipId } from '../contracts';
import { deathClipSeconds } from './deathAnimation';
import type {
  ActorColor,
  ActorId,
  AnimationModuleContext,
  AnimationPort,
  ClipId,
  DurationMs,
  SpatialActor,
} from '../contracts';
/** B-owned engine driver. The engine node is only shared via the public generic render host. */
export interface ActorRig<Node> {
  readonly node: Node;
  /** Exact absolute clip seconds; driver removes extracted translation, not visual rotation. */
  seek(clipId: ClipId, seconds: number): void;
  setEmissiveEnabled(enabled: boolean): void;
  dispose(): void;
}
export interface AnimatorAssets<Node> {
  create(color: ActorColor): ActorRig<Node>;
  clipDuration(clipId: ClipId): DurationMs | undefined;
  readonly locomotionClips: Readonly<
    Record<SpatialActor['locomotion'], ClipId>
  >;
}
export function createActorAnimator<Node>(
  context: AnimationModuleContext<Node>,
  assets: AnimatorAssets<Node>,
): AnimationPort {
  if (context.runId !== context.renderHost.runId)
    throw new Error('Mismatched render host run');
  const actors = new Map<
    ActorId,
    {
      rig: ActorRig<Node>;
      detach: () => void;
      clip: ClipId | null;
      startedAt: number;
    }
  >();
  let disposed = false;
  const remove = (id: ActorId) => {
    const entry = actors.get(id);
    if (!entry) return;
    actors.delete(id);
    const errors: unknown[] = [];
    try {
      entry.detach();
    } catch (error) {
      errors.push(error);
    }
    try {
      entry.rig.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Actor release failed');
  };
  return {
    render(frame) {
      if (
        disposed ||
        frame.snapshot.runId !== context.runId ||
        frame.spatial.runId !== context.runId
      )
        return;
      const live = new Set(frame.snapshot.actors.map((actor) => actor.actorId));
      for (const id of actors.keys()) if (!live.has(id)) remove(id);
      for (const actor of frame.snapshot.actors) {
        const spatial = frame.spatial.actors.find(
          (pose) => pose.actorId === actor.actorId,
        );
        if (!spatial) continue; // Never mount an unpositioned actor at the origin.
        let entry = actors.get(actor.actorId);
        if (!entry) {
          const rig = assets.create(actor.color);
          let detach: () => void;
          try {
            detach = context.renderHost.mountActor({
              runId: context.runId,
              actorId: actor.actorId,
              node: rig.node,
            });
          } catch (error) {
            try {
              rig.dispose();
            } catch (cleanup) {
              throw new AggregateError(
                [error, cleanup],
                'Mount and cleanup failed',
              );
            }
            throw error;
          }
          entry = {
            rig,
            detach,
            clip: null,
            startedAt: frame.snapshot.clocks.gameTimeMs,
          };
          actors.set(actor.actorId, entry);
        }
        // Defeat selection/time must be supplied by A; no inferred cause or independent clock.
        if (actor.defeated) {
          const state = actor.defeatPresentation;
          if (!state)
            throw new Error('Missing authoritative defeat presentation');
          const clip = clipId(
            state.category === 'punch' ? 'DefeatPunch' : 'DefeatKick',
          );
          if (assets.clipDuration(clip) !== 500)
            throw new Error('Death clip must be exactly 500ms');
          entry.rig.seek(
            clip,
            deathClipSeconds(state, frame.snapshot.clocks.presentationTimeMs),
          );
          entry.rig.setEmissiveEnabled(false);
          continue;
        }
        entry.rig.setEmissiveEnabled(true);
        const clip =
          actor.attack?.clipId ?? assets.locomotionClips[spatial.locomotion];
        const duration = assets.clipDuration(clip);
        if (
          duration === undefined ||
          !Number.isFinite(duration) ||
          duration <= 0
        )
          throw new Error(`Unavailable animation clip: ${clip}`);
        if (entry.clip !== clip) {
          entry.clip = clip;
          entry.startedAt = frame.snapshot.clocks.gameTimeMs;
        }
        const elapsed = Math.max(
          0,
          frame.snapshot.clocks.gameTimeMs -
            (actor.attack?.startedAt ?? entry.startedAt),
        );
        const clipMs =
          actor.attack || spatial.locomotion === 'jump'
            ? Math.min(duration, elapsed)
            : elapsed % duration;
        entry.rig.seek(clip, clipMs / 1000);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const id of [...actors.keys()])
        try {
          remove(id);
        } catch (error) {
          errors.push(error);
        }
      if (errors.length)
        throw new AggregateError(errors, 'Animation cleanup failed');
    },
  };
}

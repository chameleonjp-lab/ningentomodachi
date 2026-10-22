import type {
  ActorColor,
  ActorId,
  AnimationModuleContext,
  AnimationPort,
  ClipId,
  DefeatPoseSupportObservation,
  DurationMs,
  PresentationTimeMs,
  SpatialActor,
} from '../contracts';
import { clipId } from '../contracts';
import { deathClipSeconds } from './deathAnimation';
/** B-owned engine driver. The engine node is only shared via the public generic render host. */
export interface ActorRig<Node> {
  readonly node: Node;
  /** Exact absolute clip seconds; driver removes extracted translation, not visual rotation. */
  seek(
    clipId: ClipId,
    seconds: number,
    defeatStartedAt?: PresentationTimeMs,
  ): void;
  /** Capability is fixed for this rig. Undefined means no actual inherited entry pose. */
  defeatPoseSupport?():
    | Pick<
        DefeatPoseSupportObservation,
        'entryLocalMinY' | 'currentLocalBounds'
      >
    | undefined;
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
  let residencyMode: 'legacy' | 'explicit' | undefined;
  let previousResidents = new Set<ActorId>();
  let residencyRevision = -1;
  // Resource-free identity tombstones only; no rig or pose survives retirement.
  const retired = new Set<ActorId>();
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
      const selected = frame.snapshot.residentActorIds;
      if (selected !== undefined && !Array.isArray(selected))
        throw new Error('Invalid resident actor array');
      const mode = selected === undefined ? 'legacy' : 'explicit';
      const revision = frame.snapshot.revision;
      if (!Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid resident snapshot revision');
      if (residencyMode !== undefined && residencyMode !== mode)
        throw new Error('Cannot change residency mode within a run');
      const logicalIds = new Set(
        frame.snapshot.actors.map((actor) => actor.actorId),
      );
      const requested = selected === undefined ? [...logicalIds] : selected;
      const live = new Set(requested);
      if (
        logicalIds.size !== frame.snapshot.actors.length ||
        live.size !== requested.length ||
        requested.some((id) => !logicalIds.has(id))
      )
        throw new Error('Invalid resident actor set');
      // Validate BEFORE releasing or seeking anything: an obsolete replay must
      // not destroy the currently valid resident lifetime as a side effect.
      for (const id of live)
        if (retired.has(id))
          throw new Error(`Retired actor cannot re-enter this run: ${id}`);
      const changed =
        live.size !== previousResidents.size ||
        [...live].some((id) => !previousResidents.has(id));
      if (revision <= residencyRevision && changed)
        throw new Error('Stale or conflicting resident actor set');
      // Preflight every deterministic B-consumed requirement before any
      // retirement, disposal, mount, emission update or seek. Failed snapshots
      // must not advance the frontier or poison an otherwise valid next frame.
      const clocks = frame.snapshot.clocks;
      if (
        ![clocks.gameTimeMs, clocks.presentationTimeMs].every(
          (value) => Number.isFinite(value) && value >= 0,
        ) ||
        !Number.isSafeInteger(clocks.tick) ||
        clocks.tick < 0
      )
        throw new Error('Invalid animation clock');
      const poseIds = new Set(frame.spatial.actors.map((pose) => pose.actorId));
      if (poseIds.size !== frame.spatial.actors.length)
        throw new Error('Duplicate animation spatial actor');
      for (const actor of frame.snapshot.actors) {
        if (!live.has(actor.actorId)) continue;
        if (
          !(['white', 'black', 'blue', 'green', 'yellow'] as const).includes(
            actor.color,
          )
        )
          throw new Error('Invalid actor color');
        if (typeof actor.defeated !== 'boolean')
          throw new Error('Invalid actor defeat flag');
        const spatial = frame.spatial.actors.find(
          (pose) => pose.actorId === actor.actorId,
        );
        if (!spatial && mode === 'explicit')
          throw new Error('Missing resident spatial actor');
        if (actor.defeated) {
          const state = actor.defeatPresentation;
          if (!state)
            throw new Error('Missing authoritative defeat presentation');
          if (
            (state.category !== 'punch' && state.category !== 'kick') ||
            !Number.isFinite(state.startedAt) ||
            state.startedAt < 0 ||
            state.startedAt > clocks.presentationTimeMs ||
            !Number.isFinite(state.slowDurationMs) ||
            state.slowDurationMs < 0 ||
            state.playbackRate !== 0.25 ||
            !Number.isFinite(deathClipSeconds(state, clocks.presentationTimeMs))
          )
            throw new Error('Invalid authoritative defeat presentation');
          const clip = clipId(
            state.category === 'punch' ? 'DefeatPunch' : 'DefeatKick',
          );
          if (assets.clipDuration(clip) !== 500)
            throw new Error('Death clip must be exactly 500ms');
          if (mode === 'explicit' && !actors.has(actor.actorId))
            throw new Error('Unavailable inherited defeat entry');
        } else if (spatial) {
          const clip =
            actor.attack?.clipId ?? assets.locomotionClips[spatial.locomotion];
          if (typeof clip !== 'string' || !clip)
            throw new Error('Unavailable animation clip');
          const duration = assets.clipDuration(clip);
          if (
            duration === undefined ||
            !Number.isFinite(duration) ||
            duration <= 0
          )
            throw new Error(`Unavailable animation clip: ${clip}`);
          if (
            actor.attack &&
            (!Number.isFinite(actor.attack.startedAt) ||
              actor.attack.startedAt < 0)
          )
            throw new Error('Invalid animation attack start');
        }
      }
      residencyMode = mode;
      residencyRevision = Math.max(residencyRevision, revision);
      for (const id of previousResidents) if (!live.has(id)) retired.add(id);
      previousResidents = live;
      for (const id of actors.keys()) if (!live.has(id)) remove(id);
      for (const actor of frame.snapshot.actors) {
        if (!live.has(actor.actorId)) continue;
        const spatial = frame.spatial.actors.find(
          (pose) => pose.actorId === actor.actorId,
        );
        if (!spatial) continue; // Never mount an unpositioned actor at the origin.
        let entry = actors.get(actor.actorId);
        if (!entry) {
          const rig = assets.create(actor.color);
          let detach: () => void;
          try {
            if (
              rig.defeatPoseSupport &&
              !context.renderHost.publishDefeatPoseSupport
            )
              throw new Error('Bounds-capable rig requires support host');
            detach = context.renderHost.mountActor({
              runId: context.runId,
              actorId: actor.actorId,
              node: rig.node,
              ...(rig.defeatPoseSupport
                ? { defeatPoseSupport: 'bounds-v1' as const }
                : {}),
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
            state.startedAt,
          );
          if (entry.rig.defeatPoseSupport) {
            const support = entry.rig.defeatPoseSupport();
            if (!support)
              throw new Error('Unavailable inherited defeat support');
            if (
              !context.renderHost.publishDefeatPoseSupport?.({
                ...support,
                runId: context.runId,
                actorId: actor.actorId,
                defeatStartedAt: state.startedAt,
                tick: frame.snapshot.clocks.tick,
                presentationTimeMs: frame.snapshot.clocks.presentationTimeMs,
              })
            )
              throw new Error('Defeat support publication rejected');
          }
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
      previousResidents.clear();
      retired.clear();
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

import type {
  ActorColor,
  ActorId,
  AnimationModuleContext,
  AnimationPort,
  ClipId,
  DefeatPoseSupportObservation,
  DurationMs,
  PresentationTimeMs,
  PoseCatalogBindings,
  PoseClipBinding,
  LivingPoseStamp,
  StampedDefeatSeek,
  SpatialActor,
} from '../contracts';
import {
  clipId,
  durationMs,
  capturePoseRunPolicy,
  createLivingPoseStamp,
  createDefeatPoseStamp,
  poseClipTime,
} from '../contracts';
import { capturePoseBindings } from './poseBindings';
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
  /** Absolute canonical source sampling, independent of previously displayed channels. */
  seekPose?(binding: PoseClipBinding, clipTime: DurationMs): void;
  /** Atomic reconstruction from the immutable left-side living entry. Milliseconds, not seconds. */
  seekDefeat?(input: StampedDefeatSeek): void;
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
  readonly poseBindings?: PoseCatalogBindings;
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
  const policy = capturePoseRunPolicy(context.posePolicy);
  if (policy.mode === 'deterministic-pose-v1')
    return createStampedActorAnimator(context, assets);
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

/** Qualified display only: selection and epochs are C-owned immutable stamps. */
function createStampedActorAnimator<Node>(
  context: AnimationModuleContext<Node>,
  assets: AnimatorAssets<Node>,
): AnimationPort {
  const run = context.runId;
  const host = context.renderHost;
  if (run !== host.runId) throw new Error('Mismatched render host run');
  const descriptor = capturePoseBindings(assets.poseBindings);
  const bindings = new Map(
    descriptor.clips.map((binding) => [binding.clipId, binding]),
  );
  const duration = assets.clipDuration.bind(assets);
  for (const binding of descriptor.clips)
    if (duration(binding.clipId) !== binding.durationMs)
      throw new Error('Pose binding and visual duration differ');
  const locomotion = assets.locomotionClips;
  for (const mode of ['idle', 'walk', 'run', 'jump'] as const)
    if (locomotion[mode] !== descriptor.locomotion[mode])
      throw new Error('Pose locomotion and visual mapping differ');
  for (const name of ['DefeatPunch', 'DefeatKick'])
    if (duration(clipId(name)) !== 500)
      throw new Error('Death clip must be exactly 500ms');
  const create = assets.create.bind(assets);
  const mount = host.mountActor.bind(host);
  const publisher = host.publishDefeatPoseSupport;
  if (publisher !== undefined && typeof publisher !== 'function')
    throw new Error('Invalid support publisher');
  const publish = publisher?.bind(host);
  type Resource = {
    releaseRig: () => void;
    detach: (() => void) | null;
    released: boolean;
    mounting: boolean;
  };
  type Entry = Resource & {
    node: Node;
    color: ActorColor;
    seekPose: (binding: PoseClipBinding, time: DurationMs) => void;
    seekDefeat: (input: StampedDefeatSeek) => void;
    support: ActorRig<Node>['defeatPoseSupport'];
    emission: (enabled: boolean) => void;
    provenance: string | undefined;
  };
  type Plan = { id: ActorId; color: ActorColor } & (
    | { kind: 'living'; binding: PoseClipBinding; time: DurationMs }
    | { kind: 'defeat'; input: StampedDefeatSeek; provenance: string }
  );
  const actors = new Map<ActorId, Entry>();
  const pending = new Set<Resource>();
  const retired = new Set<ActorId>();
  let residents = new Set<ActorId>();
  let residencyMode: 'legacy' | 'explicit' | undefined;
  let frontier = -1;
  let disposed = false;
  let rendering = false;
  const active = () => {
    if (disposed) throw new Error('Animation disposed during render');
  };
  const release = (entry: Resource) => {
    // During a synchronous mount callback the detach handle is not available
    // yet. Keep ownership pending until that callback returns or throws.
    if (entry.released || entry.mounting) return;
    entry.released = true;
    pending.delete(entry);
    const errors: unknown[] = [];
    try {
      entry.detach?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      entry.releaseRig();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Actor release failed');
  };
  const captureLiving = (input: LivingPoseStamp) => {
    const stamp = createLivingPoseStamp(input);
    const binding = bindings.get(stamp.binding.clipId);
    if (
      !binding ||
      binding.sourceBindingId !== stamp.binding.sourceBindingId ||
      binding.durationMs !== stamp.binding.durationMs
    )
      throw new Error('Unprepared pose source binding');
    if (
      stamp.mode !== 'attack' &&
      descriptor.locomotion[stamp.mode] !== binding.clipId
    )
      throw new Error('Pose locomotion binding mismatch');
    return stamp;
  };
  const acquire = (color: ActorColor): Entry => {
    const rig = create(color);
    // Capture the disposer before any optional capability getter. A rig returned
    // after create reentrantly disposes us is still an owned acquisition.
    const disposeRig = rig.dispose;
    if (typeof disposeRig !== 'function')
      throw new Error('Rig has no disposer');
    const resource: Resource = {
      releaseRig: disposeRig.bind(rig),
      detach: null,
      released: false,
      mounting: false,
    };
    pending.add(resource);
    active();
    const node = rig.node;
    active();
    const seekPose = rig.seekPose;
    active();
    const seekDefeat = rig.seekDefeat;
    active();
    const support = rig.defeatPoseSupport;
    active();
    const emission = rig.setEmissiveEnabled;
    active();
    if (typeof seekPose !== 'function' || typeof seekDefeat !== 'function')
      throw new Error('Rig does not implement deterministic pose methods');
    if (
      typeof emission !== 'function' ||
      (support !== undefined && typeof support !== 'function')
    )
      throw new Error('Invalid rig presentation methods');
    if (support && !publish)
      throw new Error('Bounds-capable rig requires support host');
    return Object.assign(resource, {
      node,
      color,
      seekPose: seekPose.bind(rig),
      seekDefeat: seekDefeat.bind(rig),
      support: support?.bind(rig),
      emission: emission.bind(rig),
      provenance: undefined as string | undefined,
    });
  };
  return {
    poseProtocol: Object.freeze({
      version: 1,
      protocol: 'deterministic-pose-v1',
    }),
    render(frame) {
      if (
        disposed ||
        frame.snapshot.runId !== run ||
        frame.spatial.runId !== run
      )
        return;
      if (rendering) throw new Error('Reentrant animation render');
      rendering = true;
      try {
        const snapshot = frame.snapshot;
        const {
          gameTimeMs: now,
          presentationTimeMs: shownAt,
          tick: frameTick,
        } = snapshot.clocks;
        if (
          ![now, shownAt].every(
            (value) => Number.isFinite(value) && value >= 0,
          ) ||
          !Number.isSafeInteger(frameTick) ||
          frameTick < 0 ||
          frame.spatial.tick !== frameTick
        )
          throw new Error('Invalid committed animation clock');
        const selected = snapshot.residentActorIds;
        if (selected !== undefined && !Array.isArray(selected))
          throw new Error('Invalid resident actor array');
        const mode = selected === undefined ? 'legacy' : 'explicit';
        if (residencyMode !== undefined && mode !== residencyMode)
          throw new Error('Cannot change residency mode within a run');
        const revision = snapshot.revision;
        if (!Number.isSafeInteger(revision) || revision < 0)
          throw new Error('Invalid resident snapshot revision');
        const logical = new Set(snapshot.actors.map((actor) => actor.actorId));
        const requested = selected ?? [...logical];
        const live = new Set(requested);
        if (
          logical.size !== snapshot.actors.length ||
          live.size !== requested.length ||
          requested.some(
            (id) => !logical.has(id) || typeof id !== 'string' || !id.trim(),
          )
        )
          throw new Error('Invalid resident actor set');
        for (const id of live)
          if (retired.has(id))
            throw new Error(`Retired actor cannot re-enter this run: ${id}`);
        const changed =
          live.size !== residents.size ||
          [...live].some((id) => !residents.has(id));
        if (revision <= frontier && changed)
          throw new Error('Stale or conflicting resident actor set');
        const spatial = new Map(
          frame.spatial.actors.map((actor) => [actor.actorId, actor]),
        );
        if (spatial.size !== frame.spatial.actors.length)
          throw new Error('Duplicate animation spatial actor');
        const plans: Plan[] = [];
        for (const actor of snapshot.actors) {
          const id = actor.actorId;
          if (!live.has(id)) continue;
          const color = actor.color;
          if (
            !(['white', 'black', 'blue', 'green', 'yellow'] as const).includes(
              color,
            ) ||
            typeof actor.defeated !== 'boolean'
          )
            throw new Error('Invalid actor presentation state');
          const existing = actors.get(id);
          if (existing && existing.color !== color)
            throw new Error('Actor color changed within lifetime');
          const pose = spatial.get(id)?.pose;
          if (!pose) throw new Error('Missing resident pose stamp');
          if (!actor.defeated) {
            if (pose.kind !== 'living')
              throw new Error('Living actor requires living pose stamp');
            const stamp = captureLiving(pose.living);
            plans.push({
              id,
              color,
              kind: 'living',
              binding: stamp.binding,
              time: poseClipTime(stamp, now, 'right'),
            });
          } else {
            if (pose.kind !== 'defeat')
              throw new Error('Defeated actor requires defeat pose stamp');
            const stamp = createDefeatPoseStamp(pose);
            captureLiving(stamp.entry);
            const state = actor.defeatPresentation;
            if (!state)
              throw new Error('Missing authoritative defeat presentation');
            const { category, startedAt, slowDurationMs, playbackRate } = state;
            if (
              (category !== 'punch' && category !== 'kick') ||
              !Number.isFinite(startedAt) ||
              startedAt < 0 ||
              startedAt > shownAt ||
              !Number.isFinite(slowDurationMs) ||
              slowDurationMs < 0 ||
              playbackRate !== 0.25 ||
              stamp.defeatStartedAt !== startedAt ||
              stamp.entryAt > now
            )
              throw new Error('Invalid authoritative defeat identity');
            const clock = { category, startedAt, slowDurationMs, playbackRate };
            const input: StampedDefeatSeek = Object.freeze({
              runId: run,
              actorId: id,
              defeatStartedAt: startedAt,
              deathClipId: clipId(
                category === 'punch' ? 'DefeatPunch' : 'DefeatKick',
              ),
              deathClipTime: durationMs(
                deathClipSeconds(clock, shownAt) * 1000,
              ),
              entry: Object.freeze({
                binding: stamp.entry.binding,
                clipTime: poseClipTime(stamp.entry, stamp.entryAt, 'left'),
                sampleSide: 'left',
              }),
            });
            const provenance = JSON.stringify({ run, id, stamp, clock });
            if (
              existing?.provenance !== undefined &&
              existing.provenance !== provenance
            )
              throw new Error('Conflicting immutable defeat provenance');
            plans.push({ id, color, kind: 'defeat', input, provenance });
          }
        }
        active();
        // Pure whole-frame validation above is atomic. Once it succeeds, obey
        // the authoritative retirement before allocating any replacement rig.
        // Factory/method failures afterward fail closed; they do not resurrect
        // a retired actor or promise rollback of the old resource lifetime.
        const oldResidents = residents;
        residents = live;
        residencyMode = mode;
        frontier = Math.max(frontier, revision);
        const retirementErrors: unknown[] = [];
        for (const id of oldResidents)
          if (!live.has(id)) {
            retired.add(id);
            const entry = actors.get(id);
            actors.delete(id);
            if (entry)
              try {
                release(entry);
              } catch (error) {
                retirementErrors.push(error);
              }
            active();
          }
        if (retirementErrors.length)
          throw new AggregateError(retirementErrors, 'Actor retirement failed');
        // Capture and validate actual methods before mounting or seeking any
        // remaining actor. These are required actors, never capability probes.
        const staged = new Map<ActorId, Entry>();
        for (const plan of plans)
          if (!actors.has(plan.id)) staged.set(plan.id, acquire(plan.color));
        for (const [id, entry] of staged) {
          active();
          entry.mounting = true;
          try {
            entry.detach = mount({
              runId: run,
              actorId: id,
              node: entry.node,
              ...(entry.support
                ? { defeatPoseSupport: 'bounds-v1' as const }
                : {}),
            });
          } finally {
            entry.mounting = false;
          }
          // Detach before releasing the rig even when the callback disposed us.
          if (disposed) {
            release(entry);
            throw new Error('Animation disposed during mount');
          }
        }
        active();
        for (const [id, entry] of staged) {
          actors.set(id, entry);
          pending.delete(entry);
        }
        for (const plan of plans) {
          active();
          const entry = actors.get(plan.id);
          if (!entry) throw new Error('Resident rig unavailable');
          if (plan.kind === 'living') {
            entry.seekPose(plan.binding, plan.time);
            active();
            entry.emission(true);
            active();
          } else {
            entry.seekDefeat(plan.input);
            active();
            entry.provenance = plan.provenance;
            if (entry.support) {
              const support = entry.support();
              active();
              if (!support)
                throw new Error('Unavailable reconstructed defeat support');
              // Materialize every known property before crossing into the host.
              // A support or nested bounds getter may dispose this animator;
              // do not read another getter or publish after that callback.
              const read = <Value>(property: () => Value): Value => {
                const value = property();
                active();
                return value;
              };
              const entryLocalMinY = read(() => support.entryLocalMinY);
              const bounds = read(() => support.currentLocalBounds);
              const minimum = read(() => bounds.min);
              const min = {
                x: read(() => minimum.x),
                y: read(() => minimum.y),
                z: read(() => minimum.z),
              };
              const maximum = read(() => bounds.max);
              const max = {
                x: read(() => maximum.x),
                y: read(() => maximum.y),
                z: read(() => maximum.z),
              };
              const observation: DefeatPoseSupportObservation = {
                entryLocalMinY,
                currentLocalBounds: { min, max },
                runId: run,
                actorId: plan.id,
                defeatStartedAt: plan.input.defeatStartedAt,
                tick: frameTick,
                presentationTimeMs: shownAt,
              };
              active();
              const accepted = publish?.(observation);
              active();
              if (!accepted)
                throw new Error('Defeat support publication rejected');
            }
            entry.emission(false);
            active();
          }
        }
      } catch (error) {
        const errors = [error];
        for (const entry of [...pending])
          try {
            release(entry);
          } catch (cleanup) {
            errors.push(cleanup);
          }
        if (errors.length > 1)
          throw new AggregateError(
            errors,
            'Animation acquisition cleanup failed',
          );
        throw error;
      } finally {
        rendering = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const owned = [...actors.values(), ...pending];
      actors.clear();
      residents.clear();
      retired.clear();
      const errors: unknown[] = [];
      for (const entry of owned)
        try {
          release(entry);
        } catch (error) {
          errors.push(error);
        }
      if (errors.length)
        throw new AggregateError(errors, 'Animation cleanup failed');
    },
  };
}

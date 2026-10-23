import {
  type DurationMs,
  durationMs,
  type GameTimeMs,
  gameTimeMs,
  type PresentationTimeMs,
  presentationTimeMs,
} from './clock';
import {
  clipId,
  type ActorId,
  type AttackActivationId,
  type ClipId,
  type RunId,
} from './ids';

/** Protocol declarations describe deterministic pose timing, NOT anatomical CCD acceptance. */
export const POSE_PROTOCOL_VERSION = 1 as const;
export type LivingPoseMode = 'idle' | 'walk' | 'run' | 'jump' | 'attack';
export type PoseSampleSide = 'left' | 'right';
export interface PoseRunPolicy {
  readonly attackStartStance?: 'selected-side-kicks-v1';
  readonly version: 1;
  readonly mode: 'legacy' | 'deterministic-pose-v1';
  readonly recovery?: RecoveryTimelinePolicy;
  readonly startup?: StartupTimelinePolicy;
}
export interface PoseClipBinding {
  readonly clipId: ClipId;
  readonly durationMs: DurationMs;
  /** Opaque trusted source/root-policy equality key, never caller-selected trust. */
  readonly sourceBindingId: string;
}
export interface LivingPoseStamp {
  readonly version: 1;
  readonly binding: PoseClipBinding;
  readonly mode: LivingPoseMode;
  readonly startedAt: GameTimeMs;
  readonly playback: 'loop' | 'clamp';
  readonly activationId: AttackActivationId | null;
}
export interface DefeatPoseStamp {
  readonly kind: 'defeat';
  readonly entry: PoseEpoch;
  readonly entryAt: GameTimeMs;
  /** Matches the original Core defeatPresentation epoch; finish never restarts it. */
  readonly defeatStartedAt: PresentationTimeMs;
}
export type ActorPoseStamp =
  | {
      readonly kind: 'living';
      readonly living: LivingPoseStamp;
      readonly startupQualification?: 'unqualified-outgoing-or-basis';
    }
  | { readonly kind: 'recovery'; readonly epoch: RecoveryPoseEpoch }
  | { readonly kind: 'startup'; readonly epoch: StartupPoseEpoch }
  | DefeatPoseStamp;
/** Descriptor coverage only. No geometry/sampler or anatomy-ready flag is implied. */
export interface PoseCatalogBindings {
  readonly version: 1;
  readonly bindingSetId: string;
  readonly clips: readonly PoseClipBinding[];
  readonly locomotion: Readonly<
    Record<Exclude<LivingPoseMode, 'attack'>, ClipId>
  >;
}
export interface PoseDisplayCapability {
  readonly version: 1;
  readonly protocol: 'deterministic-pose-v1';
  /** Separate diagnostic support; v1 alone never admits a composite epoch. */
  readonly recovery?: RecoveryTimelinePolicy;
  readonly startup?: StartupTimelinePolicy;
}
export interface PoseSpatialCapability extends PoseDisplayCapability {
  /** Once per run, after catalog.prepare and before AssetsReady. Preserve pending
   * residency epochs; reject differing rebinding. Provider ownership stays in catalog. */
  bindPreparedCatalog(catalog: PoseCatalogBindings): void;
}
/** Optional future driver input. This declaration does not activate any driver. */
export interface StampedDefeatSeek {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly defeatStartedAt: PresentationTimeMs;
  readonly deathClipId: ClipId;
  readonly deathClipTime: DurationMs;
  readonly entry:
    | {
        readonly binding: PoseClipBinding;
        readonly clipTime: DurationMs;
        readonly sampleSide: 'left';
      }
    | {
        readonly kind: 'recovery';
        readonly epoch: RecoveryPoseEpoch;
        readonly at: GameTimeMs;
        readonly sampleSide: 'left';
      }
    | {
        readonly kind: 'startup';
        readonly epoch: StartupPoseEpoch;
        readonly at: GameTimeMs;
        readonly sampleSide: 'left';
      };
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function capturePoseRunPolicy(
  input: PoseRunPolicy = { version: 1, mode: 'legacy' },
): PoseRunPolicy {
  if (
    input.version !== 1 ||
    !['legacy', 'deterministic-pose-v1'].includes(input.mode)
  )
    throw new RangeError('Invalid pose run policy');
  if (input.recovery && input.mode !== 'deterministic-pose-v1')
    throw Error('Recovery requires deterministic mode');
  if (
    input.attackStartStance !== undefined &&
    input.attackStartStance !== 'selected-side-kicks-v1'
  )
    throw Error('Unsupported stance policy');
  if (
    (input.startup || input.attackStartStance) &&
    input.mode !== 'deterministic-pose-v1'
  )
    throw Error('Startup/stance requires deterministic mode');
  if (input.startup && !input.attackStartStance)
    throw Error('Startup requires explicit stance');
  return Object.freeze({
    version: 1,
    mode: input.mode,
    ...(input.attackStartStance
      ? { attackStartStance: input.attackStartStance }
      : {}),
    ...(input.startup
      ? { startup: captureStartupTimelinePolicy(input.startup) }
      : {}),
    ...(input.recovery
      ? { recovery: captureRecoveryTimelinePolicy(input.recovery) }
      : {}),
  });
}
export function createLivingPoseStamp(input: LivingPoseStamp): LivingPoseStamp {
  const { binding, mode, playback, activationId } = input;
  if (
    input.version !== 1 ||
    !['idle', 'walk', 'run', 'jump', 'attack'].includes(mode)
  )
    throw new RangeError('Invalid pose mode/version');
  if (
    !nonempty(binding.clipId) ||
    !nonempty(binding.sourceBindingId) ||
    !Number.isFinite(binding.durationMs) ||
    binding.durationMs <= 0
  )
    throw new RangeError('Invalid pose binding');
  if (playback !== (mode === 'attack' || mode === 'jump' ? 'clamp' : 'loop'))
    throw new RangeError('Invalid pose playback');
  if (mode === 'attack' ? !nonempty(activationId) : activationId !== null)
    throw new RangeError('Invalid pose activation');
  const startedAt = gameTimeMs(input.startedAt);
  const endpoint = startedAt + binding.durationMs;
  if (
    playback === 'clamp' &&
    (!Number.isFinite(endpoint) || endpoint <= startedAt)
  )
    throw new RangeError('Pose clamp endpoint is not representable');
  return Object.freeze({
    version: 1,
    binding: Object.freeze({
      clipId: binding.clipId,
      durationMs: durationMs(binding.durationMs),
      sourceBindingId: binding.sourceBindingId,
    }),
    mode,
    startedAt,
    playback,
    activationId,
  });
}
function loopPosition(stamp: LivingPoseStamp, at: GameTimeMs) {
  const duration = stamp.binding.durationMs;
  const quotient = (at - stamp.startedAt) / duration;
  let cycle = Math.floor(quotient);
  if (!Number.isSafeInteger(cycle))
    throw new RangeError('Pose loop index is not representable');
  if (at === stamp.startedAt) return { cycle: 0, time: 0, seam: true };
  // Division can round the instant BEFORE a decimal seam to an integer. Select
  // the containing representable epoch-relative interval, with no epsilon window.
  for (let correction = 0; correction < 4; correction++) {
    const left = stamp.startedAt + cycle * duration;
    const right = stamp.startedAt + (cycle + 1) * duration;
    if (!Number.isSafeInteger(cycle + 1) || right <= left)
      throw new RangeError('Pose loop boundary is not representable');
    if (at < left) {
      cycle--;
      continue;
    }
    if (at >= right) {
      cycle++;
      continue;
    }
    return { cycle, time: Math.min(duration, at - left), seam: at === left };
  }
  throw new RangeError('Pose loop interval is not representable');
}
function localTime(
  stamp: LivingPoseStamp,
  at: GameTimeMs,
  side: PoseSampleSide,
): DurationMs {
  gameTimeMs(at);
  if (side !== 'left' && side !== 'right')
    throw new RangeError('Invalid sample side');
  if (at < stamp.startedAt || (side === 'left' && at === stamp.startedAt))
    throw new RangeError('Pose has no sample before its activation');
  const elapsed = at - stamp.startedAt;
  const duration = stamp.binding.durationMs;
  if (stamp.playback === 'clamp')
    return durationMs(
      at >= stamp.startedAt + duration ? duration : Math.min(elapsed, duration),
    );
  const position = loopPosition(stamp, at);
  return durationMs(
    side === 'left' && elapsed > 0 && position.seam ? duration : position.time,
  );
}
/** Source first-key holding is B's evaluator behavior; never shift or round clip time. */
export function poseClipTime(
  stamp: LivingPoseStamp,
  at: GameTimeMs,
  side: PoseSampleSide = 'right',
): DurationMs {
  return localTime(createLivingPoseStamp(stamp), at, side);
}
export function createDefeatPoseStamp(input: DefeatPoseStamp): DefeatPoseStamp {
  if (input.kind !== 'defeat') throw new RangeError('Invalid defeat pose kind');
  const entry = capturePoseEpoch(input.entry);
  const entryAt = gameTimeMs(input.entryAt);
  resolvePoseEpoch(entry, entryAt, 'left');
  return Object.freeze({
    kind: 'defeat',
    entry,
    entryAt,
    defeatStartedAt: presentationTimeMs(input.defeatStartedAt),
  });
}
export interface PoseClipQuery {
  /** A positive game-time held piece requires point geometry, not empty coverage. */
  readonly kind: 'interval' | 'held';
  readonly gameFrom: GameTimeMs;
  readonly gameTo: GameTimeMs;
  readonly clipFrom: DurationMs;
  readonly clipTo: DurationMs;
}
/** Replayable lazy immutable pieces avoid allocation proportional to arbitrarily long
 * queries. Geometry owns [gameFrom,gameTo); clipTo is its left-limit endpoint.
 * Caller first splits selection changes; this helper never selects clips or advances time. */
export function poseClipIntervals(
  input: LivingPoseStamp,
  from: GameTimeMs,
  to: GameTimeMs,
): Iterable<PoseClipQuery> {
  const stamp = createLivingPoseStamp(input);
  gameTimeMs(from);
  gameTimeMs(to);
  if (from < stamp.startedAt || to < from)
    throw new RangeError('Invalid pose interval');
  return Object.freeze({
    *[Symbol.iterator](): Generator<PoseClipQuery> {
      let cursor = from;
      while (cursor < to) {
        const start = localTime(stamp, cursor, 'right');
        const held =
          stamp.playback === 'clamp' && start === stamp.binding.durationMs;
        const boundary =
          stamp.playback === 'clamp'
            ? stamp.startedAt + stamp.binding.durationMs
            : stamp.startedAt +
              (loopPosition(stamp, cursor).cycle + 1) *
                stamp.binding.durationMs;
        const end = held ? to : Math.min(to, boundary);
        if (!Number.isFinite(end) || end <= cursor)
          throw new RangeError('Pose interval boundary is not representable');
        yield Object.freeze({
          kind: held ? 'held' : 'interval',
          gameFrom: cursor,
          gameTo: gameTimeMs(end),
          clipFrom: start,
          clipTo: held ? start : localTime(stamp, gameTimeMs(end), 'left'),
        });
        cursor = gameTimeMs(end);
      }
    },
  });
}

/** Internal diagnostic constructor policy. Not an application run-policy activation. */
export interface RecoveryTimelinePolicy {
  readonly version: 1;
  readonly protocol: 'kungfu-recovery-epoch-diagnostic-v1';
  readonly durationMs: DurationMs;
  readonly fixedLiftSign: 1;
}
export function captureRecoveryTimelinePolicy(
  input: RecoveryTimelinePolicy,
): RecoveryTimelinePolicy {
  if (
    input.version !== 1 ||
    input.protocol !== 'kungfu-recovery-epoch-diagnostic-v1' ||
    input.durationMs !== 150 ||
    input.fixedLiftSign !== 1
  )
    throw Error('Unsupported recovery timeline policy');
  return Object.freeze({
    version: 1,
    protocol: 'kungfu-recovery-epoch-diagnostic-v1',
    durationMs: durationMs(150),
    fixedLiftSign: 1,
  });
}
export interface RecoveryPoseEpoch {
  readonly kind: 'recovery';
  readonly version: 'recovery-diagnostic-matrix-v3';
  readonly law: 'radius-fixed-lift-positive-diagonal-v1';
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly outgoing: LivingPoseStamp;
  readonly destination: LivingPoseStamp;
  readonly startMs: GameTimeMs;
  readonly endMs: GameTimeMs;
  readonly durationMs: DurationMs;
  readonly fixedLiftSign: 1;
  readonly identity: string;
}
export type PoseEpoch = LivingPoseStamp | RecoveryPoseEpoch | StartupPoseEpoch;
export function isRecoveryPoseEpoch(
  input: PoseEpoch,
): input is RecoveryPoseEpoch {
  return 'kind' in input && input.kind === 'recovery';
}
export function createRecoveryPoseEpoch(
  input: Pick<
    RecoveryPoseEpoch,
    'runId' | 'actorId' | 'outgoing' | 'destination'
  >,
): RecoveryPoseEpoch {
  const outgoing = createLivingPoseStamp(input.outgoing),
    destination = createLivingPoseStamp(input.destination);
  const startMs = gameTimeMs(outgoing.startedAt + outgoing.binding.durationMs),
    endMs = gameTimeMs(startMs + 150);
  if (
    !nonempty(input.runId) ||
    !nonempty(input.actorId) ||
    outgoing.mode !== 'attack' ||
    outgoing.binding.clipId !== 'KungFuStraight' ||
    destination.mode !== 'idle' ||
    destination.binding.clipId !== 'Idle' ||
    destination.startedAt !== startMs ||
    endMs <= startMs
  )
    throw Error('Unsupported natural recovery epoch');
  const value = {
    kind: 'recovery' as const,
    version: 'recovery-diagnostic-matrix-v3' as const,
    law: 'radius-fixed-lift-positive-diagonal-v1' as const,
    runId: input.runId,
    actorId: input.actorId,
    outgoing,
    destination,
    startMs,
    endMs,
    durationMs: durationMs(150),
    fixedLiftSign: 1 as const,
  };
  return Object.freeze({
    ...value,
    identity: `synthetic-recovery-epoch:${JSON.stringify(value, (_key, v) => (typeof v === 'number' && Object.is(v, -0) ? { rawNumber: 'negative-zero' } : v))}`,
  });
}
export function capturePoseEpoch(input: PoseEpoch): PoseEpoch {
  if (isStartupPoseEpoch(input)) {
    const captured = createStartupPoseEpoch(input);
    for (const key of [
      'kind',
      'version',
      'law',
      'deathLayerPolicy',
      'outgoingAt',
      'outgoingSide',
      'startMs',
      'endMs',
      'firstActiveAt',
      'windowPolicy',
      'rootPolicy',
      'fixedLiftSign',
      'identity',
    ] as const)
      if (!Object.is(input[key], captured[key]))
        throw Error('Conflicting startup epoch identity');
    return captured;
  }
  if (!isRecoveryPoseEpoch(input)) return createLivingPoseStamp(input);
  const captured = createRecoveryPoseEpoch(input);
  if (
    input.identity !== captured.identity ||
    input.version !== captured.version ||
    input.law !== captured.law ||
    input.startMs !== captured.startMs ||
    input.endMs !== captured.endMs ||
    input.durationMs !== captured.durationMs ||
    input.fixedLiftSign !== captured.fixedLiftSign
  )
    throw Error('Conflicting recovery epoch identity');
  return captured;
}
export type ResolvedPoseEpoch =
  | Readonly<{
      kind: 'startup';
      epoch: StartupPoseEpoch;
      at: GameTimeMs;
      side: PoseSampleSide;
      weight: number;
      sourceClipTime: DurationMs;
    }>
  | Readonly<{
      kind: 'canonical';
      stamp: LivingPoseStamp;
      clipTime: DurationMs;
      side: PoseSampleSide;
    }>
  | Readonly<{
      kind: 'recovery';
      epoch: RecoveryPoseEpoch;
      at: GameTimeMs;
      side: PoseSampleSide;
    }>;
export function resolvePoseEpoch(
  input: PoseEpoch,
  at: GameTimeMs,
  side: PoseSampleSide,
): ResolvedPoseEpoch {
  const epoch = capturePoseEpoch(input);
  gameTimeMs(at);
  if (!['left', 'right'].includes(side)) throw Error('Invalid pose side');
  if (isStartupPoseEpoch(epoch)) {
    if (at < epoch.startMs || at > epoch.endMs)
      throw Error('Outside startup epoch');
    const weight =
      at === epoch.startMs
        ? 0
        : at === epoch.endMs
          ? 1
          : (at - epoch.startMs) / epoch.policy.durationMs;
    return Object.freeze({
      kind: 'startup',
      epoch,
      at,
      side,
      weight,
      sourceClipTime: durationMs(at - epoch.startMs),
    });
  }
  if (!isRecoveryPoseEpoch(epoch))
    return Object.freeze({
      kind: 'canonical',
      stamp: epoch,
      clipTime: poseClipTime(epoch, at, side),
      side,
    });
  if (at < epoch.startMs || at > epoch.endMs)
    throw Error('Outside recovery epoch');
  if (at === epoch.startMs)
    return Object.freeze({
      kind: 'canonical',
      stamp: epoch.outgoing,
      clipTime: poseClipTime(epoch.outgoing, at, 'left'),
      side: 'left',
    });
  if (at === epoch.endMs)
    return Object.freeze({
      kind: 'canonical',
      stamp: epoch.destination,
      clipTime: poseClipTime(epoch.destination, at, side),
      side,
    });
  return Object.freeze({ kind: 'recovery', epoch, at, side });
}

/** Retained source/policy pins only. These windows are provisional, not production combat acceptance. */
export const STARTUP_SOURCES = Object.freeze({
  SideKick: Object.freeze({
    binding: Object.freeze({
      clipId: clipId('SideKick'),
      durationMs: durationMs(1177.7777671813965),
      sourceBindingId:
        'pose-v1:4fb6ea03f86f501457176d3bcbe0faa092cfdde4c6501c22a77eb99b0d451d43',
    }),
    firstActiveMs: durationMs(533.3333611488342),
    rootPolicy: 'grounded-posture-y' as const,
  }),
  SideThrustKick: Object.freeze({
    binding: Object.freeze({
      clipId: clipId('SideThrustKick'),
      durationMs: durationMs(1577.7777433395386),
      sourceBindingId:
        'pose-v1:4e4d36d46458cb46c30d95a9ed430827b6587ba6db22ab486debfe74524fab24',
    }),
    firstActiveMs: durationMs(755.5555701255798),
    rootPolicy: 'in-place-posture-xyz' as const,
  }),
});
export function startupSource(name: string) {
  return name === 'SideKick'
    ? STARTUP_SOURCES.SideKick
    : name === 'SideThrustKick'
      ? STARTUP_SOURCES.SideThrustKick
      : undefined;
}
export interface StartupTimelinePolicyV1 {
  readonly version: 1;
  readonly protocol: 'side-kick-startup-matrix-v1';
  readonly durationMs: DurationMs;
  readonly fixedLiftSign: 1;
}
export interface StartupTimelinePolicyV2 {
  readonly version: 2;
  readonly protocol: 'side-kick-startup-matrix-v2';
  readonly durationMs: DurationMs;
  readonly fixedLiftSign: 1;
  readonly domain: 'fixed-positive-lift-midpoint-half-v1';
}
export type StartupTimelinePolicy =
  | StartupTimelinePolicyV1
  | StartupTimelinePolicyV2;
export function captureStartupTimelinePolicy(
  input: StartupTimelinePolicy,
): StartupTimelinePolicy {
  const validVersion =
    input.version === 1
      ? input.protocol === 'side-kick-startup-matrix-v1'
      : input.version === 2 &&
        input.protocol === 'side-kick-startup-matrix-v2' &&
        input.domain === 'fixed-positive-lift-midpoint-half-v1';
  if (
    !validVersion ||
    input.fixedLiftSign !== 1 ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0 ||
    input.durationMs > Number.MAX_SAFE_INTEGER
  )
    throw Error('Unsupported startup policy');
  if (input.version === 2)
    return Object.freeze({
      version: 2,
      protocol: 'side-kick-startup-matrix-v2',
      durationMs: durationMs(input.durationMs),
      fixedLiftSign: 1,
      domain: 'fixed-positive-lift-midpoint-half-v1',
    });
  return Object.freeze({
    version: 1,
    protocol: 'side-kick-startup-matrix-v1',
    durationMs: durationMs(input.durationMs),
    fixedLiftSign: 1,
  });
}
export interface StartupBasis {
  readonly authority: 'activation-stance-v1';
  readonly oldYaw: number;
  readonly admittedYaw: number;
}
export interface StartupPoseEpoch {
  readonly kind: 'startup';
  readonly version: 'startup-shared-matrix-v1' | 'startup-shared-matrix-v2';
  readonly law:
    | 'radius-fixed-lift-positive-diagonal-with-basis-v1'
    | 'radius-fixed-positive-midpoint-half-with-basis-v2';
  readonly deathLayerPolicy: 'freeze-entry-through-local-death-v1';
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly outgoing: LivingPoseStamp;
  readonly outgoingAt: GameTimeMs;
  readonly outgoingSide: 'left';
  readonly destination: LivingPoseStamp;
  readonly basis: StartupBasis;
  readonly policy: StartupTimelinePolicy;
  readonly startMs: GameTimeMs;
  readonly endMs: GameTimeMs;
  readonly firstActiveAt: GameTimeMs;
  readonly windowPolicy: 'inclusive-accessor-frame-cells-v1:provisional-policy';
  readonly rootPolicy: 'grounded-posture-y' | 'in-place-posture-xyz';
  readonly fixedLiftSign: 1;
  readonly identity: string;
}
export function isStartupPoseEpoch(
  input: PoseEpoch,
): input is StartupPoseEpoch {
  return 'kind' in input && input.kind === 'startup';
}
export function createStartupPoseEpoch(
  input: Pick<
    StartupPoseEpoch,
    'runId' | 'actorId' | 'outgoing' | 'destination' | 'basis' | 'policy'
  >,
): StartupPoseEpoch {
  const outgoing = createLivingPoseStamp(input.outgoing),
    destination = createLivingPoseStamp(input.destination);
  const policy = captureStartupTimelinePolicy(input.policy),
    pin = startupSource(destination.binding.clipId);
  const startMs = destination.startedAt,
    endMs = gameTimeMs(startMs + policy.durationMs);
  if (
    !nonempty(input.runId) ||
    !nonempty(input.actorId) ||
    outgoing.mode !== 'idle' ||
    outgoing.binding.clipId !== 'Idle' ||
    destination.mode !== 'attack' ||
    !pin ||
    destination.binding.durationMs !== pin.binding.durationMs ||
    destination.binding.sourceBindingId !== pin.binding.sourceBindingId
  )
    throw Error('Unsupported startup source domain');
  poseClipTime(outgoing, startMs, 'left');
  const firstActiveAt = gameTimeMs(startMs + pin.firstActiveMs);
  if (
    !(
      startMs < endMs &&
      endMs < firstActiveAt &&
      firstActiveAt <= Number.MAX_SAFE_INTEGER
    )
  )
    throw Error('Unrepresentable startup interval');
  if (
    input.basis.authority !== 'activation-stance-v1' ||
    !Number.isFinite(input.basis.oldYaw) ||
    !Number.isFinite(input.basis.admittedYaw)
  )
    throw Error('Invalid startup basis');
  const basis = Object.freeze({
    authority: input.basis.authority,
    oldYaw: input.basis.oldYaw,
    admittedYaw: input.basis.admittedYaw,
  });
  const value = {
    kind: 'startup' as const,
    version:
      policy.version === 1
        ? ('startup-shared-matrix-v1' as const)
        : ('startup-shared-matrix-v2' as const),
    law:
      policy.version === 1
        ? ('radius-fixed-lift-positive-diagonal-with-basis-v1' as const)
        : ('radius-fixed-positive-midpoint-half-with-basis-v2' as const),
    deathLayerPolicy: 'freeze-entry-through-local-death-v1' as const,
    runId: input.runId,
    actorId: input.actorId,
    outgoing,
    outgoingAt: startMs,
    outgoingSide: 'left' as const,
    destination,
    basis,
    policy,
    startMs,
    endMs,
    firstActiveAt,
    windowPolicy:
      'inclusive-accessor-frame-cells-v1:provisional-policy' as const,
    rootPolicy: pin.rootPolicy,
    fixedLiftSign: 1 as const,
  };
  return Object.freeze({
    ...value,
    identity: `synthetic-startup-epoch:${JSON.stringify(value, (_key, v) => (typeof v === 'number' && Object.is(v, -0) ? { rawNumber: 'negative-zero' } : v))}`,
  });
}
/** Stage2 readiness MUST invoke this before AssetsReady; deterministic v1 alone
 * does not authorize the shared matrix layer or frozen-layer death semantics. */
export function requireStartupCapability(
  required: StartupTimelinePolicy,
  capability: PoseDisplayCapability | undefined,
): void {
  const policy = captureStartupTimelinePolicy(required);
  if (
    capability?.version !== 1 ||
    capability.protocol !== 'deterministic-pose-v1' ||
    !capability.startup ||
    JSON.stringify(captureStartupTimelinePolicy(capability.startup)) !==
      JSON.stringify(policy)
  )
    throw Error('Missing or conflicting startup capability');
}

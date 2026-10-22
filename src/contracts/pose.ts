import {
  durationMs,
  gameTimeMs,
  presentationTimeMs,
  type DurationMs,
  type GameTimeMs,
  type PresentationTimeMs,
} from './clock';
import type { ActorId, AttackActivationId, ClipId, RunId } from './ids';

/** Protocol declarations describe deterministic pose timing, NOT anatomical CCD acceptance. */
export const POSE_PROTOCOL_VERSION = 1 as const;
export type LivingPoseMode = 'idle' | 'walk' | 'run' | 'jump' | 'attack';
export type PoseSampleSide = 'left' | 'right';
export interface PoseRunPolicy {
  readonly version: 1;
  readonly mode: 'legacy' | 'deterministic-pose-v1';
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
  readonly entry: LivingPoseStamp;
  readonly entryAt: GameTimeMs;
  /** Matches the original Core defeatPresentation epoch; finish never restarts it. */
  readonly defeatStartedAt: PresentationTimeMs;
}
export type ActorPoseStamp =
  | { readonly kind: 'living'; readonly living: LivingPoseStamp }
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
  readonly entry: {
    readonly binding: PoseClipBinding;
    readonly clipTime: DurationMs;
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
  return Object.freeze({ version: 1, mode: input.mode });
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
  const entry = createLivingPoseStamp(input.entry);
  const entryAt = gameTimeMs(input.entryAt);
  localTime(entry, entryAt, 'left');
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

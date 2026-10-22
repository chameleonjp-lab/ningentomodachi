import type { DurationMs } from './clock';
import type { ClipId } from './ids';
export type AttackCategory = 'punch' | 'kick';
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface MotionImpact {
  /** Clip-local stable index; only A creates activation-scoped runtime ImpactIds. */
  readonly impactIndex: number;
  readonly startMs: DurationMs;
  readonly endMs: DurationMs;
  readonly damageShare: number;
  /** Stable reference into B's validated hit-shape/trajectory catalog. */
  readonly shapeId: string;
}
export interface RootSample {
  readonly atMs: DurationMs;
  readonly position: Vector3;
  /** Unwrapped radians: preserve authored full turns, never shortest-angle interpolation. */
  readonly visualYawRad: number;
}
export interface MotionDefinition {
  readonly clipId: ClipId;
  readonly category: AttackCategory;
  readonly durationMs: DurationMs;
  /** Measured reach including both root motion and the attacking limb. */
  readonly effectiveRangeM: number;
  readonly impacts: readonly MotionImpact[];
  readonly rootCurve: readonly RootSample[];
  readonly sampling: MotionSamplingDescriptor;
}
export interface MetadataValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}
export function validateMotionDefinition(
  motion: MotionDefinition,
): MetadataValidation {
  const errors: string[] = [];
  if (!motion.clipId.trim()) errors.push('clipId');
  if (motion.category !== 'punch' && motion.category !== 'kick')
    errors.push('category');
  if (!Number.isFinite(motion.durationMs) || motion.durationMs <= 0)
    errors.push('durationMs');
  if (!Number.isFinite(motion.effectiveRangeM) || motion.effectiveRangeM <= 0)
    errors.push('effectiveRangeM');
  if (!motion.impacts.length) errors.push('impacts');
  const ids = new Set<number>();
  let shares = 0;
  for (const impact of motion.impacts) {
    if (
      !Number.isSafeInteger(impact.impactIndex) ||
      impact.impactIndex < 0 ||
      ids.has(impact.impactIndex)
    )
      errors.push('impactIndex');
    ids.add(impact.impactIndex);
    if (!impact.shapeId.trim()) errors.push('shapeId');
    if (
      !Number.isFinite(impact.startMs) ||
      !Number.isFinite(impact.endMs) ||
      impact.startMs < 0 ||
      impact.startMs >= impact.endMs ||
      impact.endMs > motion.durationMs
    )
      errors.push('impactWindow');
    if (
      !Number.isFinite(impact.damageShare) ||
      impact.damageShare <= 0 ||
      impact.damageShare > 1
    )
      errors.push('damageShare');
    shares += impact.damageShare;
  }
  if (Math.abs(shares - 1) > 1e-9) errors.push('totalDamageShare');
  let previous = -1;
  for (const sample of motion.rootCurve) {
    if (
      !Number.isFinite(sample.atMs) ||
      sample.atMs < 0 ||
      sample.atMs <= previous ||
      sample.atMs > motion.durationMs
    )
      errors.push('rootTime');
    if (
      ![sample.position.x, sample.position.y, sample.position.z].every(
        Number.isFinite,
      )
    )
      errors.push('rootPosition');
    if (!Number.isFinite(sample.visualYawRad)) errors.push('rootYaw');
    previous = sample.atMs;
  }
  if (
    motion.rootCurve[0]?.atMs !== 0 ||
    motion.rootCurve.at(-1)?.atMs !== motion.durationMs
  )
    errors.push('rootCoverage');
  if (
    motion.sampling.version !== 1 ||
    motion.sampling.interpolation !== 'piecewise-linear' ||
    !Number.isFinite(motion.sampling.sampleRateHz) ||
    motion.sampling.sampleRateHz <= 0
  )
    errors.push('sampling');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

/** Frozen B -> C convention. GLB axis/scale conversion happens once in B, never in C. */
export const MOTION_SPACE = Object.freeze({
  version: 1,
  distanceUnit: 'metres',
  timeUnit: 'clip-milliseconds',
  handedness: 'right',
  up: '+Y',
  forward: '+Z',
  right: '+X',
  origin: 'actor-feet',
  hitVolumeSpace: 'actor-local-with-root-translation-removed',
} as const);
export interface MotionSamplingDescriptor {
  readonly version: 1;
  readonly sampleRateHz: number;
  readonly interpolation: 'piecewise-linear';
}
export type HitVolume =
  | {
      readonly kind: 'sphere';
      readonly center: Vector3;
      readonly radiusM: number;
    }
  | {
      readonly kind: 'capsule';
      readonly start: Vector3;
      readonly end: Vector3;
      readonly radiusM: number;
    };
export interface MotionRootSegment {
  readonly from: RootSample;
  readonly to: RootSample;
  readonly deltaTranslation: Vector3;
  readonly horizontalOwner: 'authored-root' | 'spatial-movement';
  /** Exclusive: authored Y and C's jump/gravity must never be added together. */
  readonly verticalOwner: 'authored-root' | 'spatial-jump';
  /** Actor world facing is held by C; visual root yaw must not rotate that basis again. */
  readonly yawOwner: 'visual-only';
}
export interface HitVolumeSegment {
  readonly impactIndex: number;
  readonly shapeId: string;
  readonly fromMs: DurationMs;
  readonly toMs: DurationMs;
  readonly activeWindow: {
    readonly startMs: DurationMs;
    readonly endMs: DurationMs;
  };
  readonly from: HitVolume;
  readonly to: HitVolume;
}
/**
 * Deterministic, mixer-independent interval samples. Query times satisfy 0 <= from <= to <= duration.
 * B returns undefined only for unknown clips and rejects invalid intervals with RangeError.
 * Root segments partition the requested interval, splitting at every curve key/ownership change.
 * Hit segments split at curve keys and active-window boundaries; windows are [start, end).
 * Contact times for a positive query belong to [from, to): a shared tick boundary belongs to
 * the following interval. Segment end geometry exists for interpolation, not double ownership.
 * Centers, endpoints, radii and root translation interpolate linearly per segment; visual yaw is
 * unwrapped linear radians. C applies its collision-resolved actor world transform exactly once.
 * C sweeps each segment and excludes the inactive end boundary; A deduplicates runtime ImpactIds.
 * A zero-length query returns no segments. Sampling never advances a clock or mutates a mixer.
 */
export interface MotionIntervalSample {
  readonly clipId: ClipId;
  readonly fromMs: DurationMs;
  readonly toMs: DurationMs;
  readonly space: typeof MOTION_SPACE;
  readonly rootSegments: readonly MotionRootSegment[];
  readonly hitVolumeSegments: readonly HitVolumeSegment[];
}

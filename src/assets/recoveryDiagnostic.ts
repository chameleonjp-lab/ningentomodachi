/** Optional offline adapter only. No timeline selection or live consumer dispatch. */
import {
  type ActorId,
  capturePoseEpoch,
  isRecoveryPoseEpoch,
  resolvePoseEpoch,
  poseClipIntervals,
  type PoseEpoch,
  type PoseClipQuery,
  createLivingPoseStamp,
  type DurationMs,
  durationMs,
  type GameTimeMs,
  gameTimeMs,
  type LivingPoseStamp,
  type PoseSampleSide,
  poseClipTime,
  type RunId,
} from '../contracts';
import {
  blendPose,
  capturePose,
  composePoseMatrices,
  type LocalPose,
} from './poseRecipeMath';
import type { ClipRootPolicy } from './rootPolicy';
export interface CanonicalPoseQuery {
  readonly stamp: LivingPoseStamp;
  readonly at: GameTimeMs;
  readonly side: PoseSampleSide;
  readonly clipTime: DurationMs;
}
export interface CanonicalPoseSnapshot {
  readonly query: CanonicalPoseQuery;
  readonly rootMode: ClipRootPolicy['mode'];
  readonly hierarchyId: string;
  readonly pose: LocalPose;
}
export interface RecoveryDiagnosticInput {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly outgoing: LivingPoseStamp;
  readonly destination: LivingPoseStamp;
  readonly durationMs: DurationMs;
  readonly diagnostic: true;
  readonly fixedLiftSign: 1 | -1;
}
export interface RecoveryDiagnostic extends RecoveryDiagnosticInput {
  readonly version: 'recovery-diagnostic-matrix-v3';
  readonly law: 'radius-fixed-lift-positive-diagonal-v1';
  readonly startMs: GameTimeMs;
  readonly endMs: GameTimeMs;
  readonly identity: string;
}
export interface RecoveryDiagnosticSample {
  readonly kind: 'canonical' | 'synthetic-recovery';
  readonly recipeIdentity: string;
  readonly pose: LocalPose;
  readonly hierarchyId: string;
  readonly destinationQuery?: CanonicalPoseQuery;
}
export interface RecoveryRigDiagnostic {
  sampleCanonical(query: CanonicalPoseQuery): CanonicalPoseSnapshot;
  /** Complete local-pose apply on a dedicated diagnostic rig only. No C parent. */
  apply(pose: LocalPose): void;
}
export interface RecoveryHeadDiagnostic {
  sampleCanonical(query: CanonicalPoseQuery): CanonicalPoseSnapshot;
  /** Derive numeric reference transform from the composed ancestor closure. */
  matrix(pose: LocalPose): readonly number[];
}
export function captureCanonicalQuery(
  stamp: LivingPoseStamp,
  at: GameTimeMs,
  side: PoseSampleSide,
): CanonicalPoseQuery {
  const captured = createLivingPoseStamp(stamp);
  const time = gameTimeMs(at);
  return Object.freeze({
    stamp: captured,
    at: time,
    side,
    clipTime: poseClipTime(captured, time, side),
  });
}
export function validateCanonicalQuery(
  q: CanonicalPoseQuery,
): CanonicalPoseQuery {
  const captured = captureCanonicalQuery(q.stamp, q.at, q.side);
  if (captured.clipTime !== q.clipTime)
    throw Error('Canonical clock/side mismatch');
  return captured;
}
export function captureCanonicalSnapshot(
  query: CanonicalPoseQuery,
  rootMode: ClipRootPolicy['mode'],
  pose: LocalPose,
  hierarchyId: string,
): CanonicalPoseSnapshot {
  if (
    ![
      'full-translation',
      'grounded-posture-y',
      'in-place-posture-xyz',
    ].includes(rootMode) ||
    typeof hierarchyId !== 'string' ||
    !hierarchyId
  )
    throw Error('Invalid canonical provenance');
  composePoseMatrices(pose);
  return Object.freeze({
    query: validateCanonicalQuery(query),
    rootMode,
    hierarchyId,
    pose: capturePose(pose),
  });
}
export function createRecoveryDiagnostic(
  input: RecoveryDiagnosticInput,
): RecoveryDiagnostic {
  const outgoing = createLivingPoseStamp(input.outgoing),
    destination = createLivingPoseStamp(input.destination),
    duration = durationMs(input.durationMs);
  if (
    input.diagnostic !== true ||
    ![1, -1].includes(input.fixedLiftSign) ||
    !input.runId?.trim() ||
    !input.actorId?.trim() ||
    duration <= 0 ||
    outgoing.mode !== 'attack' ||
    outgoing.binding.clipId !== 'KungFuStraight' ||
    destination.mode !== 'idle' ||
    destination.binding.clipId !== 'Idle'
  )
    throw Error('Unsupported recovery diagnostic');
  const start = gameTimeMs(outgoing.startedAt + outgoing.binding.durationMs),
    end = gameTimeMs(start + duration);
  if (destination.startedAt !== start || end <= start || !Number.isFinite(end))
    throw Error('Invalid natural completion epoch');
  const value = {
    version: 'recovery-diagnostic-matrix-v3' as const,
    law: 'radius-fixed-lift-positive-diagonal-v1' as const,
    fixedLiftSign: input.fixedLiftSign,
    runId: input.runId,
    actorId: input.actorId,
    outgoing,
    destination,
    durationMs: duration,
    diagnostic: true as const,
    startMs: start,
    endMs: end,
  };
  return Object.freeze({
    ...value,
    identity: `synthetic-recovery:${JSON.stringify(value, (_key, v) => (typeof v === 'number' && Object.is(v, -0) ? { rawNumber: 'negative-zero' } : v))}`,
  });
}
export function sampleRecoveryDiagnostic(
  recipe: RecoveryDiagnostic,
  at: GameTimeMs,
  side: PoseSampleSide,
  evaluate: (q: CanonicalPoseQuery) => CanonicalPoseSnapshot,
): RecoveryDiagnosticSample {
  const r = createRecoveryDiagnostic(recipe);
  if (
    r.identity !== recipe.identity ||
    recipe.version !== r.version ||
    recipe.law !== r.law ||
    recipe.startMs !== r.startMs ||
    recipe.endMs !== r.endMs ||
    !Number.isFinite(at) ||
    at < r.startMs ||
    at > r.endMs ||
    !['left', 'right'].includes(side)
  )
    throw Error('Invalid recipe identity/time/side');
  const read = (q: CanonicalPoseQuery) => {
    const result = evaluate(q),
      captured = captureCanonicalSnapshot(
        result.query,
        result.rootMode,
        result.pose,
        result.hierarchyId,
      );
    if (JSON.stringify(captured.query) !== JSON.stringify(q))
      throw Error('Canonical source provenance mismatch');
    return captured;
  };
  const outgoing = read(captureCanonicalQuery(r.outgoing, r.startMs, 'left'));
  if (at === r.startMs)
    return Object.freeze({
      kind: 'synthetic-recovery',
      recipeIdentity: r.identity,
      pose: outgoing.pose,
      hierarchyId: outgoing.hierarchyId,
    });
  const destinationQuery = captureCanonicalQuery(r.destination, at, side),
    destination = read(destinationQuery);
  if (outgoing.hierarchyId !== destination.hierarchyId)
    throw Error('Hierarchy provenance mismatch');
  const u = (at - r.startMs) / r.durationMs,
    weight = u * u * (3 - 2 * u);
  return Object.freeze({
    kind: at === r.endMs ? 'canonical' : 'synthetic-recovery',
    recipeIdentity: r.identity,
    pose: blendPose(outgoing.pose, destination.pose, weight, r.fixedLiftSign),
    hierarchyId: outgoing.hierarchyId,
    destinationQuery,
  });
}

/** Shared C epoch authority; no consumer may substitute a private recovery clock. */
export function samplePoseEpoch(
  epochInput: PoseEpoch,
  at: GameTimeMs,
  side: PoseSampleSide,
  evaluate: (q: CanonicalPoseQuery) => CanonicalPoseSnapshot,
): RecoveryDiagnosticSample {
  const epoch = capturePoseEpoch(epochInput);
  resolvePoseEpoch(epoch, at, side);
  if (isRecoveryPoseEpoch(epoch)) {
    const recipe = createRecoveryDiagnostic({ ...epoch, diagnostic: true });
    const sample = sampleRecoveryDiagnostic(recipe, at, side, evaluate);
    return Object.freeze({ ...sample, recipeIdentity: epoch.identity });
  }
  const query = captureCanonicalQuery(epoch, at, side),
    raw = evaluate(query);
  const captured = captureCanonicalSnapshot(
    raw.query,
    raw.rootMode,
    raw.pose,
    raw.hierarchyId,
  );
  if (JSON.stringify(captured.query) !== JSON.stringify(query))
    throw Error('Canonical epoch provenance mismatch');
  return Object.freeze({
    kind: 'canonical',
    recipeIdentity: `canonical-epoch:${JSON.stringify(epoch)}`,
    pose: captured.pose,
    hierarchyId: captured.hierarchyId,
    destinationQuery: query,
  });
}
export type PoseEpochInterval =
  | Readonly<{
      kind: 'canonical';
      stamp: LivingPoseStamp;
      query: PoseClipQuery;
    }>
  | Readonly<{
      kind: 'unsupported';
      reason: 'recovery-interval';
      resolution: 'unresolved';
      identity: string;
      from: GameTimeMs;
      to: GameTimeMs;
    }>;
/** Caller supplies one authoritative selection span, already cut at interruptions/death. */
export function poseEpochIntervals(
  input: PoseEpoch,
  from: GameTimeMs,
  to: GameTimeMs,
): Iterable<PoseEpochInterval> {
  const epoch = capturePoseEpoch(input);
  gameTimeMs(from);
  gameTimeMs(to);
  if (to < from) throw Error('Invalid epoch interval');
  return Object.freeze({
    *[Symbol.iterator](): Generator<PoseEpochInterval> {
      const canonical = function* (
        stamp: LivingPoseStamp,
        a: GameTimeMs,
        b: GameTimeMs,
      ): Generator<PoseEpochInterval> {
        for (const query of poseClipIntervals(stamp, a, b))
          yield Object.freeze({ kind: 'canonical', stamp, query });
      };
      if (!isRecoveryPoseEpoch(epoch)) {
        yield* canonical(epoch, from, to);
        return;
      }
      if (from < epoch.outgoing.startedAt)
        throw Error('Interval predates source activation');
      if (from < epoch.startMs)
        yield* canonical(
          epoch.outgoing,
          from,
          gameTimeMs(Math.min(to, epoch.startMs)),
        );
      const left = gameTimeMs(Math.max(from, epoch.startMs)),
        right = gameTimeMs(Math.min(to, epoch.endMs));
      if (left < right)
        yield Object.freeze({
          kind: 'unsupported',
          reason: 'recovery-interval',
          resolution: 'unresolved',
          identity: epoch.identity,
          from: left,
          to: right,
        });
      if (to > epoch.endMs)
        yield* canonical(
          epoch.destination,
          gameTimeMs(Math.max(from, epoch.endMs)),
          to,
        );
    },
  });
}

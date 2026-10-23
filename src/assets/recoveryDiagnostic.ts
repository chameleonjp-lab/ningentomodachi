/** Optional offline adapter only. No timeline selection or live consumer dispatch. */
import { Matrix4 } from 'three';
import {
  isStartupPoseEpoch,
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
  blendStartupPoseV2,
  capturePose,
  composePoseMatrices,
  checkedMatrixProduct,
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
  readonly kind: 'canonical' | 'synthetic-recovery' | 'synthetic-startup';
  readonly basisLayer?: readonly number[];
  readonly recipeIdentity: string;
  readonly pose: LocalPose;
  readonly hierarchyId: string;
  readonly destinationQuery?: CanonicalPoseQuery;
}
export interface RecoveryRigDiagnostic {
  sampleCanonical(query: CanonicalPoseQuery): CanonicalPoseSnapshot;
  /** Complete local-pose apply on a dedicated diagnostic rig only. No C parent. */
  apply(pose: LocalPose, basisLayer?: readonly number[]): void;
  basisLayer?(): readonly number[] | undefined;
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
  const resolved = resolvePoseEpoch(epoch, at, side);
  if (isStartupPoseEpoch(epoch)) {
    if (resolved.kind !== 'startup') throw Error('Invalid startup resolution');
    const read = (q: CanonicalPoseQuery) => {
      const raw = evaluate(q);
      const result = captureCanonicalSnapshot(
        raw.query,
        raw.rootMode,
        raw.pose,
        raw.hierarchyId,
      );
      if (JSON.stringify(result.query) !== JSON.stringify(q))
        throw Error('Startup canonical provenance mismatch');
      return result;
    };
    const outgoing = read(
      captureCanonicalQuery(epoch.outgoing, epoch.outgoingAt, 'left'),
    );
    // The startup endpoint exists on either sample side. The incoming source
    // begins here, so validate its zero pose on the right while the outgoing
    // contribution remains the actual strict-left Idle sample.
    const destinationQuery = captureCanonicalQuery(
      epoch.destination,
      at,
      at === epoch.startMs ? 'right' : side,
    );
    const incoming = read(destinationQuery);
    if (
      outgoing.hierarchyId !== incoming.hierarchyId ||
      outgoing.pose.length !== incoming.pose.length ||
      outgoing.pose.some(
        (n, i) =>
          n.id !== incoming.pose[i]?.id ||
          n.parent !== incoming.pose[i]?.parent,
      )
    )
      throw Error('Startup topology mismatch');
    if (
      incoming.rootMode !== epoch.rootPolicy ||
      outgoing.rootMode !== 'full-translation'
    )
      throw Error('Startup root policy mismatch');
    const weight = resolved.weight,
      delta = epoch.basis.oldYaw - epoch.basis.admittedYaw;
    if (Math.abs(delta) > Math.PI) throw Error('Unsupported startup basis arc');
    // The basis matrix is shared recipe data, never decomposed into raw source TRS.
    const basisLayer = captureBasisLayer(
      (weight === 1 || delta === 0
        ? new Matrix4()
        : new Matrix4().makeRotationY(delta * (1 - weight))
      ).toArray(),
    );
    const pose =
      epoch.version === 'startup-shared-matrix-v2'
        ? blendStartupPoseV2(outgoing.pose, incoming.pose, weight)
        : weight === 0
          ? outgoing.pose
          : weight === 1
            ? incoming.pose
            : blendPose(outgoing.pose, incoming.pose, weight, 1);
    composePoseMatrices(pose, basisLayer);
    return Object.freeze({
      kind: 'synthetic-startup',
      recipeIdentity: epoch.identity,
      pose,
      hierarchyId: outgoing.hierarchyId,
      destinationQuery,
      basisLayer,
    });
  }
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
      reason: 'recovery-interval' | 'startup-interval';
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
      if (!isRecoveryPoseEpoch(epoch) && !isStartupPoseEpoch(epoch)) {
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
          reason: isStartupPoseEpoch(epoch)
            ? 'startup-interval'
            : 'recovery-interval',
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

/** Only the declared yaw matrix law is admitted. Dense own finite values; no TRS decomposition. */
export function captureBasisLayer(input: readonly number[]): readonly number[] {
  if (!Array.isArray(input) || input.length !== 16)
    throw Error('Invalid basis layer');
  const a: number[] = [];
  for (let i = 0; i < 16; i++) {
    const p = Object.getOwnPropertyDescriptor(input, i);
    if (
      !p ||
      !('value' in p) ||
      typeof p.value !== 'number' ||
      !Number.isFinite(p.value)
    )
      throw Error('Invalid basis layer');
    a.push(p.value);
  }
  if (
    a[1] !== 0 ||
    a[3] !== 0 ||
    a[4] !== 0 ||
    a[5] !== 1 ||
    a[6] !== 0 ||
    a[7] !== 0 ||
    a[9] !== 0 ||
    a[11] !== 0 ||
    a[12] !== 0 ||
    a[13] !== 0 ||
    a[14] !== 0 ||
    a[15] !== 1 ||
    a[0] !== a[10] ||
    a[2] !== -a[8]!
  )
    throw Error('Unsupported basis layer law');
  const c = a[0]!,
    v = a[8]!;
  if (Math.abs(c * c + v * v - 1) > Number.EPSILON * 4)
    throw Error('Unsupported basis layer rotation');
  return Object.freeze(a);
}
export function composeBasisLayer(
  matrix: readonly number[],
  layer?: readonly number[],
): readonly number[] {
  return checkedMatrixProduct(
    layer ? captureBasisLayer(layer) : new Matrix4().toArray(),
    matrix,
  );
}

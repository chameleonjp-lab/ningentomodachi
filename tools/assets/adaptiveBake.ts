import { durationMs, type HitVolume, type Vector3 } from '../../src/contracts';
import {
  bakeMotion,
  type BakeInput,
  type EvaluatedPose,
} from '../../src/assets/bakeMotion';

type Evaluator = {
  sample: (atMs: ReturnType<typeof durationMs>) => EvaluatedPose;
  dispose: () => void;
};
const accounting = () => ({
  factoryAttempts: 0,
  evaluatorAcquisitions: 0,
  disposalAttempts: 0,
  disposalCompletions: 0,
  bakeSampleAttempts: 0,
  bakeSampleCompletions: 0,
  verificationSampleAttempts: 0,
  verificationSampleCompletions: 0,
  blockedSampleCalls: 0,
  sphereComparisons: 0,
  capsuleComparisons: 0,
});
export interface AdaptiveFailureDiagnostic {
  readonly reason: string;
  readonly round: number;
  readonly maximumMeasuredResidualM: number;
  readonly pendingKeyCount: number;
  readonly accounting: Readonly<ReturnType<typeof accounting>>;
  readonly cleanupErrors: readonly unknown[];
}
export class AdaptiveRefinementError extends Error {
  constructor(
    cause: unknown,
    readonly diagnostic: AdaptiveFailureDiagnostic,
  ) {
    super(diagnostic.reason, { cause });
    this.name = 'AdaptiveRefinementError';
  }
}
function finite(...values: number[]) {
  if (!values.every(Number.isFinite))
    throw new Error('Nonfinite adaptive geometry/arithmetic');
}
function valid(v: HitVolume) {
  const points = v.kind === 'sphere' ? [v.center] : [v.start, v.end];
  finite(v.radiusM);
  if (v.radiusM <= 0) throw new Error('Invalid adaptive radius');
  for (const p of points) finite(p.x, p.y, p.z);
}
function distanceToSegment(p: Vector3, a: Vector3, b: Vector3) {
  const x = b.x - a.x,
    y = b.y - a.y,
    z = b.z - a.z;
  const px = p.x - a.x,
    py = p.y - a.y,
    pz = p.z - a.z;
  const lengthSquared = x * x + y * y + z * z;
  const dot = px * x + py * y + pz * z;
  finite(x, y, z, px, py, pz, lengthSquared, dot);
  if (lengthSquared === 0 && (x !== 0 || y !== 0 || z !== 0))
    throw new Error('Unresolved adaptive segment underflow');
  const u =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot / lengthSquared));
  const distance = Math.hypot(
    p.x - (a.x + x * u),
    p.y - (a.y + y * u),
    p.z - (a.z + z * u),
  );
  finite(u, distance);
  return distance;
}
/** Float64 sampled diagnostic, not a rounded or continuous containment certificate.
 * Only adds measured keys. Factory initialization and bakeMotion preprocessing are
 * outside the returned-sample call budget; source use needs separate admission. */
export async function refineActiveEnvelopes(
  input: BakeInput,
  createEvaluator: () => Promise<Evaluator>,
) {
  const toleranceM = 1e-7;
  const added = new Set<number>();
  const counts = accounting();
  const cleanupErrors: unknown[] = [];
  let round = 0,
    maximumMeasuredResidualM = 0,
    pendingKeyCount = 0;
  async function use<T>(
    phase: 'bake' | 'verification',
    body: (sample: Evaluator['sample']) => T,
  ): Promise<T> {
    counts.factoryAttempts++;
    const evaluator = await createEvaluator();
    counts.evaluatorAcquisitions++;
    let attempts = 0,
      failed = false;
    let result!: T;
    let primary: unknown;
    try {
      result = body((atMs) => {
        const cap = phase === 'bake' ? 20000 : 59997;
        if (attempts >= cap) {
          counts.blockedSampleCalls++;
          throw new Error(
            'Adaptive envelope exceeds bounded key/sample budget',
          );
        }
        attempts++;
        if (phase === 'bake') counts.bakeSampleAttempts++;
        else counts.verificationSampleAttempts++;
        const pose = evaluator.sample(atMs);
        if (phase === 'bake') counts.bakeSampleCompletions++;
        else counts.verificationSampleCompletions++;
        return pose;
      });
    } catch (error) {
      failed = true;
      primary = error;
    }
    counts.disposalAttempts++;
    try {
      evaluator.dispose();
      counts.disposalCompletions++;
    } catch (error) {
      cleanupErrors.push(error);
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
    if (failed) throw primary;
    return result;
  }
  try {
    for (round = 0; round <= 8; round++) {
      maximumMeasuredResidualM = 0;
      pendingKeyCount = 0;
      const asset = await use('bake', (sample) =>
        bakeMotion(
          { ...input, sourceTimesMs: [...input.sourceTimesMs, ...added] },
          sample,
        ),
      );
      const insert = new Set<number>();
      await use('verification', (sample) => {
        const times = asset.definition.rootCurve;
        for (let i = 1; i < times.length; i++) {
          const a = times[i - 1],
            b = times[i];
          if (!a || !b) throw new Error('Missing adaptive interval');
          const active = asset.shapes.filter((shape) =>
            input.impacts.some(
              (impact) =>
                impact.shapeId === shape.shapeId &&
                a.atMs >= impact.startMs &&
                b.atMs <= impact.endMs,
            ),
          );
          if (!active.length) continue;
          for (const fraction of [0.25, 0.5, 0.75]) {
            const atMs = a.atMs + (b.atMs - a.atMs) * fraction;
            if (!(a.atMs < atMs && atMs < b.atMs))
              throw new Error('Unresolved adaptive strict-interior interval');
            const pose = sample(durationMs(atMs));
            for (const shape of active) {
              const from = shape.keys[i - 1]?.volume,
                to = shape.keys[i]?.volume;
              const matches = pose.shapes.filter(
                  (item) => item.shapeId === shape.shapeId,
                ),
                actual = matches[0]?.volume;
              if (matches.length !== 1 || !from || !to || !actual)
                throw new Error('Unresolved/duplicate adaptive shape');
              valid(from);
              valid(to);
              valid(actual);
              const lerp = (a: number, b: number) => a + (b - a) * fraction;
              let residual: number;
              if (
                from.kind === 'sphere' &&
                to.kind === 'sphere' &&
                actual.kind === 'sphere'
              ) {
                counts.sphereComparisons++;
                residual =
                  Math.hypot(
                    actual.center.x - lerp(from.center.x, to.center.x),
                    actual.center.y - lerp(from.center.y, to.center.y),
                    actual.center.z - lerp(from.center.z, to.center.z),
                  ) +
                  actual.radiusM -
                  lerp(from.radiusM, to.radiusM);
              } else if (
                from.kind === 'capsule' &&
                to.kind === 'capsule' &&
                actual.kind === 'capsule'
              ) {
                counts.capsuleComparisons++;
                // Match public catalog interpolation at the represented timestamp,
                // not the nominal probe fraction (which can round differently).
                const alpha = (atMs - a.atMs) / (b.atMs - a.atMs);
                finite(alpha);
                const capsuleLerp = (a: number, b: number) =>
                  a + (b - a) * alpha;
                const vector = (a: Vector3, b: Vector3) => ({
                  x: capsuleLerp(a.x, b.x),
                  y: capsuleLerp(a.y, b.y),
                  z: capsuleLerp(a.z, b.z),
                });
                const start = vector(from.start, to.start),
                  end = vector(from.end, to.end);
                const radius = capsuleLerp(from.radiusM, to.radiusM);
                finite(start.x, start.y, start.z, end.x, end.y, end.z, radius);
                residual =
                  Math.max(
                    distanceToSegment(actual.start, start, end),
                    distanceToSegment(actual.end, start, end),
                  ) +
                  actual.radiusM -
                  radius;
              } else throw new Error('Adaptive shape kind changed');
              finite(residual);
              maximumMeasuredResidualM = Math.max(
                maximumMeasuredResidualM,
                residual,
              );
              if (residual > toleranceM) {
                insert.add(atMs);
                pendingKeyCount = insert.size;
              }
            }
          }
        }
      });
      if (!insert.size)
        return {
          asset,
          diagnostics: {
            toleranceM,
            rounds: round,
            addedKeyCount: added.size,
            addedKeysMs: [...added].sort((a, b) => a - b),
            maximumMeasuredResidualM,
            limitation:
              'Quarter/mid/three-quarter samples only; no analytic continuous-containment or device-performance acceptance',
            accounting: Object.freeze({ ...counts }),
          },
        };
      for (const time of insert) added.add(time);
    }
    round = 8;
    throw new Error('Adaptive envelope did not converge within bounded rounds');
  } catch (cause) {
    throw new AdaptiveRefinementError(
      cause,
      Object.freeze({
        reason: cause instanceof Error ? cause.message : String(cause),
        round,
        maximumMeasuredResidualM,
        pendingKeyCount,
        accounting: Object.freeze({ ...counts }),
        cleanupErrors: Object.freeze([...cleanupErrors]),
      }),
    );
  }
}

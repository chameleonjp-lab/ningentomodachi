import { durationMs } from '../../src/contracts';
import {
  bakeMotion,
  type BakeInput,
  type EvaluatedPose,
} from '../../src/assets/bakeMotion';

/** Diagnostic sampled refinement, not an analytic continuous-motion certificate.
 * Only adds measured keys; no unreported radius inflation or window changes. */
export async function refineActiveEnvelopes(
  input: BakeInput,
  createEvaluator: () => Promise<{
    sample: (atMs: ReturnType<typeof durationMs>) => EvaluatedPose;
    dispose: () => void;
  }>,
) {
  const toleranceM = 1e-7;
  const added = new Set<number>();
  for (let round = 0; round <= 8; round++) {
    const evaluator = await createEvaluator();
    let asset: ReturnType<typeof bakeMotion>;
    try {
      asset = bakeMotion(
        { ...input, sourceTimesMs: [...input.sourceTimesMs, ...added] },
        evaluator.sample,
      );
    } finally {
      evaluator.dispose();
    }
    if (asset.definition.rootCurve.length > 20000)
      throw new Error('Adaptive envelope exceeds bounded key budget');
    const verification = await createEvaluator();
    const insert = new Set<number>();
    let maximumMeasuredResidualM = 0;
    try {
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
          const pose = verification.sample(durationMs(atMs));
          for (const shape of active) {
            const from = shape.keys[i - 1]?.volume,
              to = shape.keys[i]?.volume;
            const actual = pose.shapes.find(
              (item) => item.shapeId === shape.shapeId,
            )?.volume;
            if (
              from?.kind !== 'sphere' ||
              to?.kind !== 'sphere' ||
              actual?.kind !== 'sphere'
            )
              throw new Error('Adaptive diagnostics require measured spheres');
            const lerp = (a: number, b: number) => a + (b - a) * fraction;
            const residual =
              Math.hypot(
                actual.center.x - lerp(from.center.x, to.center.x),
                actual.center.y - lerp(from.center.y, to.center.y),
                actual.center.z - lerp(from.center.z, to.center.z),
              ) +
              actual.radiusM -
              lerp(from.radiusM, to.radiusM);
            maximumMeasuredResidualM = Math.max(
              maximumMeasuredResidualM,
              residual,
            );
            if (residual > toleranceM) insert.add(atMs);
          }
        }
      }
    } finally {
      verification.dispose();
    }
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
        },
      };
    for (const time of insert) added.add(time);
  }
  throw new Error('Adaptive envelope did not converge within bounded rounds');
}

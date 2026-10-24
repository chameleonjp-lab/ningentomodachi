/** Local two-origin adapter. Shared evaluator/cache/lifecycle contracts remain unchanged. */
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';
import { readKungFuSweepLowerLegCandidate } from './kungFuSweepLowerLegCandidate';
export async function bakeKungFuSweepLowerLeg(
  input: Parameters<typeof readKungFuSweepLowerLegCandidate>[0] & {
    readonly receipt: MeasuredJointReceipt;
  },
  sourceFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const candidate = readKungFuSweepLowerLegCandidate(input);
  if (input.receipt.maxSourceUpdates > candidate.schedule.maximumSourceUpdates)
    throw new Error('Expanded source update budget forbidden');
  const startId = 'KungFuSweep:private-origin:shin',
    endId = 'KungFuSweep:private-origin:ankle';
  // Positive helper radii satisfy the existing origin-sphere contract only. They
  // are discarded, never baked or admitted as additional collision volumes.
  const shapes = [
    { shapeId: startId, bone: 'shin.R', radiusM: 1 },
    { shapeId: endId, bone: 'foot.R', radiusM: 1 },
  ];
  const localFactory: typeof createSourceEvaluator = async (
    bytes,
    clipName,
    annotations,
    policy,
    execution,
  ) => {
    const original = await sourceFactory(
      bytes,
      clipName,
      annotations,
      policy,
      execution,
    );
    const adapted: SourceEvaluator = {
      surfaceSelections: [],
      sample(atMs) {
        if (original.surfaceSelections.length !== 0)
          throw new Error(
            'Origin observations must have empty surface selections',
          );
        const pose = original.sample(atMs);
        if (pose.shapes.length !== 2)
          throw new Error('Exactly two private origin observations required');
        const starts = pose.shapes.filter((s) => s.shapeId === startId),
          ends = pose.shapes.filter((s) => s.shapeId === endId);
        const a = starts[0]?.volume,
          b = ends[0]?.volume;
        if (
          starts.length !== 1 ||
          ends.length !== 1 ||
          a?.kind !== 'sphere' ||
          b?.kind !== 'sphere'
        )
          throw new Error('Unique private sphere origins required');
        for (const point of [a.center, b.center])
          if (![point.x, point.y, point.z].every(Number.isFinite))
            throw new Error('Nonfinite capsule endpoint');
        if (
          a.center.x === b.center.x &&
          a.center.y === b.center.y &&
          a.center.z === b.center.z
        )
          throw new Error('Degenerate capsule axis');
        // Source centers already remove extracted translation and retain visual yaw.
        // Do not subtract root again, reapply yaw, or flatten source posture.
        return {
          root: pose.root,
          rawRoot: pose.rawRoot,
          shapes: [
            {
              shapeId: candidate.shapeId,
              volume: {
                kind: 'capsule',
                start: { ...a.center },
                end: { ...b.center },
                radiusM: candidate.model.radiusM,
              },
            },
          ],
        };
      },
      dispose() {
        original.dispose();
      },
    };
    return adapted;
  };
  const result = await bakeMeasuredJoint(
    {
      sourceBytes: input.sourceBytes,
      clipName: 'KungFuSweep',
      shapes,
      rootPolicy: candidate.rootPolicy,
      bakeInput: {
        clipId: candidate.clipId,
        category: candidate.category,
        durationMs: candidate.durationMs,
        sampleRateHz: candidate.schedule.sampleRateHz,
        sourceTimesMs: candidate.sourceTimesSeconds.map((t) => t * 1000),
        impacts: candidate.impacts,
        ownership: candidate.ownership,
      },
      sampleTimesMs: candidate.schedule.sampleKeysMs,
      receipt: input.receipt,
    },
    localFactory,
  );
  return { ...result, candidate };
}

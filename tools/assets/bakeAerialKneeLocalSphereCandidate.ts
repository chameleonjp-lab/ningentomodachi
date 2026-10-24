/** Offline developer collision candidate, never catalog activation or anatomical admission. */
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { durationMs } from '../../src/contracts';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';
import { planAerialKneeLocalSphereCandidate } from './aerialKneeLocalSphereCandidate';

type Input = Parameters<typeof planAerialKneeLocalSphereCandidate>[0];
type Selection = SourceEvaluator['surfaceSelections'];
function freeze<T>(value: T): T {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite candidate result');
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validateSelection(selections: Selection) {
  if (selections.length !== 0)
    throw new Error(
      'Knee-local fixed-radius model requires empty surface selection',
    );
}
function validateFreshReceipt(receipt: MeasuredJointReceipt) {
  if (
    receipt.maxSourceUpdates !== 533 ||
    receipt.attemptedSourceUpdates !== 0 ||
    receipt.startupUpdates !== 0 ||
    receipt.sampleUpdates !== 0 ||
    receipt.rejectedUpdates !== 0 ||
    receipt.attemptedTimesMs.length ||
    receipt.rootQuaternionObservations.length ||
    receipt.cleanupErrors.length
  )
    throw new Error('Fresh exact knee-local budget receipt required');
}
export async function bakeAerialKneeLocalSphereCandidate(
  input: Input,
  receipt: MeasuredJointReceipt,
  gate: {
    readonly sourceExecutionReleased: true;
    readonly sourceSha256: string;
    readonly sampleTimesSha256: string;
    readonly modelSha256: string;
    readonly maxSourceUpdates: 533;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const plan = planAerialKneeLocalSphereCandidate(input);
  if (
    !gate ||
    gate.sourceExecutionReleased !== true ||
    gate.sourceSha256 !== plan.source.sourceSha256 ||
    gate.sampleTimesSha256 !== plan.scheduleHashes.sampleTimesMs ||
    gate.modelSha256 !== plan.modelSha256 ||
    gate.maxSourceUpdates !== 533
  )
    throw new Error('Exact knee-local execution gate required');
  validateFreshReceipt(receipt);
  // The shared adapter owns lifetime and cleanup. Selection is checked before its first sample;
  // factory startup may already have happened. Keep original receiver and error identity.
  const checkedFactory: typeof createSourceEvaluator = async (...args) => {
    const evaluator = await evaluatorFactory(...args);
    let checked = false;
    return {
      surfaceSelections: evaluator.surfaceSelections,
      sample(atMs) {
        if (!checked) {
          validateSelection(evaluator.surfaceSelections);
          checked = true;
        }
        const pose = evaluator.sample(atMs),
          volume = pose.shapes[0]?.volume;
        if (
          pose.shapes.length !== 1 ||
          pose.shapes[0]?.shapeId !== plan.model.shapeId ||
          volume?.kind !== 'sphere' ||
          volume.radiusM !== plan.model.radiusM
        )
          throw new Error('Knee-local fixed sphere identity/radius mismatch');
        return pose;
      },
      dispose() {
        evaluator.dispose();
      },
    };
  };
  const measured = await bakeMeasuredJoint(
    {
      sourceBytes: input.sourceBytes,
      clipName: 'AerialKnee',
      shapes: [
        {
          shapeId: plan.model.shapeId,
          bone: 'shin.R',
          radiusM: plan.model.radiusM,
        },
      ],
      rootPolicy: plan.metadata.rootPolicy,
      bakeInput: {
        clipId: plan.metadata.clipId,
        category: 'kick',
        durationMs: plan.metadata.durationMs,
        sampleRateHz: 240,
        sourceTimesMs: plan.schedule.candidateTimesMs,
        impacts: [
          {
            ...plan.impact,
            startMs: durationMs(plan.impact.startMs),
            endMs: durationMs(plan.impact.endMs),
          },
        ],
        ownership: [
          {
            atMs: durationMs(0),
            horizontalOwner: 'authored-root',
            verticalOwner: 'authored-root',
          },
        ],
      },
      sampleTimesMs: plan.schedule.sampleTimesMs,
      receipt,
    },
    checkedFactory,
  );
  validateSelection(measured.surfaceSelections);
  if (
    receipt.attemptedSourceUpdates !== 533 ||
    receipt.startupUpdates !== 1 ||
    receipt.sampleUpdates !== 532 ||
    receipt.rejectedUpdates !== 0 ||
    receipt.cleanupErrors.length ||
    receipt.rootQuaternionObservations.length !== 533 ||
    JSON.stringify(receipt.attemptedTimesMs) !==
      JSON.stringify([0, ...plan.schedule.sampleTimesMs])
  )
    throw new Error('Knee-local execution receipt mismatch');
  for (const [i, witness] of receipt.rootQuaternionObservations.entries()) {
    if (
      witness.stage !== (i === 0 ? 'startup' : 'sample') ||
      witness.atMs !== (i === 0 ? 0 : plan.schedule.sampleTimesMs[i - 1]) ||
      witness.quaternion.length !== 4 ||
      !witness.quaternion.every(Number.isFinite) ||
      Math.abs(Math.hypot(...witness.quaternion) - 1) > 1e-4
    )
      throw new Error('Knee-local root quaternion witness mismatch');
  }
  const roots = measured.asset.definition.rootCurve,
    curve = measured.asset.shapes[0];
  if (
    measured.asset.shapes.length !== 1 ||
    !curve ||
    curve.shapeId !== plan.model.shapeId ||
    roots.length !== 418 ||
    curve.keys.length !== 418 ||
    roots.some((root, i) => root.atMs !== plan.schedule.candidateTimesMs[i])
  )
    throw new Error('Knee-local baked key identity mismatch');
  const probes = [];
  let maximumPositiveEnvelopeExceedanceM = 0,
    maximumRootInterpolationErrorM = 0;
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  for (let i = 1; i < roots.length; i++) {
    const a = roots[i - 1],
      b = roots[i],
      from = curve.keys[i - 1],
      to = curve.keys[i];
    if (
      !a ||
      !b ||
      !from ||
      !to ||
      from.atMs !== a.atMs ||
      to.atMs !== b.atMs ||
      from.volume.kind !== 'sphere' ||
      to.volume.kind !== 'sphere'
    )
      throw new Error('Knee-local sphere key mismatch');
    const fromVolume = from.volume,
      toVolume = to.volume;
    if (a.atMs < plan.impact.startMs || b.atMs > plan.impact.endMs) continue;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const atMs = lerp(a.atMs, b.atMs, fraction),
        pose = measured.poses.get(atMs),
        actual = pose?.shapes[0]?.volume;
      if (
        !pose ||
        pose.shapes.length !== 1 ||
        pose.shapes[0]?.shapeId !== plan.model.shapeId ||
        actual?.kind !== 'sphere' ||
        actual.radiusM !== plan.model.radiusM
      )
        throw new Error('Missing exact knee-local probe');
      const rootInterpolationErrorM = Math.hypot(
        ...(['x', 'y', 'z'] as const).map(
          (axis) =>
            pose.root.position[axis] -
            lerp(a.position[axis], b.position[axis], fraction),
        ),
      );
      const envelopeResidualM =
        Math.hypot(
          ...(['x', 'y', 'z'] as const).map(
            (axis) =>
              pose.root.position[axis] +
              actual.center[axis] -
              lerp(
                a.position[axis] + fromVolume.center[axis],
                b.position[axis] + toVolume.center[axis],
                fraction,
              ),
          ),
        ) +
        actual.radiusM -
        lerp(fromVolume.radiusM, toVolume.radiusM, fraction);
      maximumPositiveEnvelopeExceedanceM = Math.max(
        maximumPositiveEnvelopeExceedanceM,
        envelopeResidualM,
      );
      maximumRootInterpolationErrorM = Math.max(
        maximumRootInterpolationErrorM,
        rootInterpolationErrorM,
      );
      probes.push({
        atMs,
        fraction,
        envelopeResidualM,
        rootInterpolationErrorM,
      });
    }
  }
  if (
    probes.length !== 114 ||
    probes.some((probe, i) => probe.atMs !== plan.schedule.probeTimesMs[i])
  )
    throw new Error('Knee-local probe schedule mismatch');
  return freeze({
    status:
      'MEASURED_DEVELOPER_KNEE_LOCAL_SPHERE_CANDIDATE_NOT_ACCEPTED' as const,
    evaluationKind:
      evaluatorFactory === createSourceEvaluator
        ? ('original-source-diagnostic' as const)
        : ('synthetic-control' as const),
    plan,
    // Diagnostic replay cache only, never part of the MotionAsset schema.
    sampledPoses: plan.schedule.sampleTimesMs.map((atMs) => {
      const pose = measured.poses.get(atMs);
      if (!pose) throw new Error('Missing retained exact pose');
      return { atMs, pose: structuredClone(pose) };
    }),
    asset: structuredClone(measured.asset),
    surfaceSelections: structuredClone(measured.surfaceSelections),
    rootQuaternionWitnesses: structuredClone(
      receipt.rootQuaternionObservations,
    ),
    scalarYawInterpretation: receipt.scalarYawInterpretation,
    probes,
    maximumPositiveEnvelopeExceedanceM,
    maximumRootInterpolationErrorM,
    probeCoverage: 'finite-active-quarter-mid-threequarter-only' as const,
    emptySpaceExcess: null,
    limitation:
      'The fixed knee-origin sphere and finite interpolation probes are not gameplay admission or exact anatomy. Empty-space excess, actual near misses, clashes and unchanged hurt geometry require separate review. Native root XYZ and authored identity STEP pelvis rotation remain in measured geometry; root quaternion identity is not a reason to flatten motion.',
    sourceAuthoredAnatomy: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

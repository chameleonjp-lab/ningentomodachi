/** Offline developer collision candidate, never catalog activation or anatomical admission. */
import { createHash } from 'node:crypto';
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { durationMs } from '../../src/contracts';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';
import {
  planFlippingSlashWholeHandCandidate,
  type FlippingSlashWholeHandPlan,
} from './flippingSlashWholeHandCandidate';

type Input = Parameters<typeof planFlippingSlashWholeHandCandidate>[0];
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
function validateSelection(
  plan: FlippingSlashWholeHandPlan,
  selections: Selection,
) {
  const selected = selections[0];
  if (
    selections.length !== 1 ||
    !selected ||
    selected.shapeId !== plan.model.shapeId ||
    selected.bone !== 'hand.R'
  )
    throw new Error('Whole-hand selection identity mismatch');
  const expected = plan.expectedSelection.primitives.filter((p) => p.count > 0);
  if (selected.meshes.length !== expected.length)
    throw new Error('Whole-hand selection primitive count mismatch');
  const seen = new Set<number>();
  let total = 0;
  for (const mesh of selected.meshes) {
    const primitive = mesh.sourcePrimitiveIndex;
    if (
      primitive === undefined ||
      !Number.isSafeInteger(primitive) ||
      seen.has(primitive) ||
      mesh.sourceMeshIndex !== 0 ||
      !mesh.meshName
    )
      throw new Error('Whole-hand selection mesh/primitive mismatch');
    seen.add(primitive);
    const pin = expected.find((p) => p.index === primitive);
    if (
      !pin ||
      mesh.vertexIndices.length !== pin.count ||
      new Set(mesh.vertexIndices).size !== mesh.vertexIndices.length
    )
      throw new Error('Whole-hand selection vertex count mismatch');
    const bytes = new Uint8Array(mesh.vertexIndices.length * 4),
      view = new DataView(bytes.buffer);
    mesh.vertexIndices.forEach((index, i) => {
      if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff)
        throw new Error('Whole-hand selection invalid vertex');
      view.setUint32(i * 4, index, true);
    });
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
      throw new Error('Whole-hand selection vertex provenance mismatch');
    total += mesh.vertexIndices.length;
  }
  if (total !== 4223) throw new Error('Whole-hand selection total mismatch');
}
export function validateFlippingSlashWholeHandSelection(
  input: Input,
  selections: Selection,
) {
  validateSelection(planFlippingSlashWholeHandCandidate(input), selections);
}
function validateFreshReceipt(receipt: MeasuredJointReceipt) {
  if (
    receipt.maxSourceUpdates !== 687 ||
    receipt.attemptedSourceUpdates !== 0 ||
    receipt.startupUpdates !== 0 ||
    receipt.sampleUpdates !== 0 ||
    receipt.rejectedUpdates !== 0 ||
    receipt.attemptedTimesMs.length ||
    receipt.rootQuaternionObservations.length ||
    receipt.cleanupErrors.length
  )
    throw new Error('Fresh exact whole-hand budget receipt required');
}
export async function bakeFlippingSlashWholeHandCandidate(
  input: Input,
  receipt: MeasuredJointReceipt,
  gate: {
    readonly sourceExecutionReleased: true;
    readonly sourceSha256: string;
    readonly sampleTimesSha256: string;
    readonly maxSourceUpdates: 687;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const plan = planFlippingSlashWholeHandCandidate(input);
  if (
    !gate ||
    gate.sourceExecutionReleased !== true ||
    gate.sourceSha256 !== plan.source.sourceSha256 ||
    gate.sampleTimesSha256 !== plan.scheduleHashes.sampleTimesMs ||
    gate.maxSourceUpdates !== 687
  )
    throw new Error('Exact whole-hand execution gate required');
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
          validateSelection(plan, evaluator.surfaceSelections);
          checked = true;
        }
        return evaluator.sample(atMs);
      },
      dispose() {
        evaluator.dispose();
      },
    };
  };
  const measured = await bakeMeasuredJoint(
    {
      sourceBytes: input.sourceBytes,
      clipName: 'FlippingSlash',
      shapes: [
        {
          shapeId: plan.model.shapeId,
          bone: 'hand.R',
          surface: 'dominant-skin-subtree',
        },
      ],
      rootPolicy: plan.metadata.rootPolicy,
      bakeInput: {
        clipId: plan.metadata.clipId,
        category: 'punch',
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
  validateSelection(plan, measured.surfaceSelections);
  if (
    receipt.attemptedSourceUpdates !== 687 ||
    receipt.startupUpdates !== 1 ||
    receipt.sampleUpdates !== 686 ||
    receipt.rejectedUpdates !== 0 ||
    receipt.cleanupErrors.length ||
    receipt.rootQuaternionObservations.length !== 687 ||
    JSON.stringify(receipt.attemptedTimesMs) !==
      JSON.stringify([0, ...plan.schedule.sampleTimesMs])
  )
    throw new Error('Whole-hand execution receipt mismatch');
  for (const [i, witness] of receipt.rootQuaternionObservations.entries()) {
    if (
      witness.stage !== (i === 0 ? 'startup' : 'sample') ||
      witness.atMs !== (i === 0 ? 0 : plan.schedule.sampleTimesMs[i - 1]) ||
      witness.quaternion.length !== 4 ||
      !witness.quaternion.every(Number.isFinite) ||
      Math.abs(Math.hypot(...witness.quaternion) - 1) > 1e-4
    )
      throw new Error('Whole-hand root quaternion witness mismatch');
  }
  const roots = measured.asset.definition.rootCurve,
    curve = measured.asset.shapes[0];
  if (
    measured.asset.shapes.length !== 1 ||
    !curve ||
    curve.shapeId !== plan.model.shapeId ||
    roots.length !== 575 ||
    curve.keys.length !== 575 ||
    roots.some((root, i) => root.atMs !== plan.schedule.candidateTimesMs[i])
  )
    throw new Error('Whole-hand baked key identity mismatch');
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
      throw new Error('Whole-hand sphere key mismatch');
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
        actual.radiusM <= 0
      )
        throw new Error('Missing exact whole-hand probe');
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
    probes.length !== 111 ||
    probes.some((probe, i) => probe.atMs !== plan.schedule.probeTimesMs[i])
  )
    throw new Error('Whole-hand probe schedule mismatch');
  return freeze({
    status: 'MEASURED_DEVELOPER_WHOLE_HAND_CANDIDATE_NOT_ACCEPTED' as const,
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
      'Measured sphere containment and finite interpolation probes are not gameplay admission. Empty-space excess, actual near misses, clashes and unchanged hurt geometry require separate review. Full native root flip remains in measured geometry, not reconstructed from scalar Euler yaw.',
    sourceAuthoredAnatomy: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

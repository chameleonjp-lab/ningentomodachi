/** Offline candidate only. No CLI, publication, runtime activation or acceptance. */
import { createHash } from 'node:crypto';
import { clipId, durationMs } from '../../src/contracts';
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readCartwheelKickCollisionCandidate } from './cartwheelKickCollisionCandidate';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';

// Raw rendered-index first appearance; dominant max weight uses first slot on ties.
// Only L joints47/48; foot+toe is a developer choice.
const selectionPins = [
  [
    {
      count: 615,
      hash: '413e162d2d48b100ddb3a0db24910fa9a386b074d51551a9e80d14e7f77998ba',
    },
    {
      count: 440,
      hash: '9b74b4b86887c9f81cab06fbefcf25ee6cddf65a151e2a838a1a6ef3b064c21f',
    },
    {
      count: 386,
      hash: 'd14d48682798ab5cc8a07fdf36a0a707fe7fb6d61b786088de45fb4fc0526102',
    },
    {
      count: 588,
      hash: 'f8bc4638ef40322bee11eb3eacd6515204b0fce2342f2188eeec3b3f86e810d8',
    },
    {
      count: 255,
      hash: '46df79122594c2ba2b9879aa7bbfb413018108876bdaf58bc6865e69e2133c65',
    },
  ],
] as const;
function verifySelection(
  selections: SourceEvaluator['surfaceSelections'],
  shapes: readonly { shapeId: string; bone: string }[],
) {
  if (selections.length !== 1 || shapes.length !== 1)
    throw new Error('CartwheelKick selection identity mismatch');
  shapes.forEach((shape, side) => {
    const selected = selections[side];
    if (
      !selected ||
      selected.shapeId !== shape.shapeId ||
      selected.bone !== shape.bone ||
      selected.meshes.length !== 5
    )
      throw new Error('CartwheelKick selection identity mismatch');
    const meshes = [...selected.meshes].sort(
      (a, b) => (a.sourcePrimitiveIndex ?? -1) - (b.sourcePrimitiveIndex ?? -1),
    );
    meshes.forEach((mesh, primitive) => {
      const pin = selectionPins[side]?.[primitive];
      if (
        !pin ||
        mesh.sourceMeshIndex !== 0 ||
        mesh.sourcePrimitiveIndex !== primitive ||
        typeof mesh.meshName !== 'string' ||
        !mesh.meshName.trim() ||
        mesh.vertexIndices.length !== pin.count ||
        createHash('sha256')
          .update(JSON.stringify(mesh.vertexIndices))
          .digest('hex') !== pin.hash
      )
        throw new Error('CartwheelKick selection provenance/vertex mismatch');
    });
  });
}

export async function bakeCartwheelKickCollisionCandidate(
  input: {
    readonly sourceBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly receipt: MeasuredJointReceipt;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const sourceBytes = new Uint8Array(input.sourceBytes);
  const declaration = readCartwheelKickCollisionCandidate({
    sourceBytes,
    manifestBytes: new Uint8Array(input.manifestBytes),
  });
  if (
    input.receipt.maxSourceUpdates > declaration.schedule.maximumSourceUpdates
  )
    throw new RangeError('CartwheelKick source budget exceeds fixed ceiling');
  const checkedFactory: typeof createSourceEvaluator = async (...args) => {
    const original = await evaluatorFactory(...args);
    let checked = false;
    return {
      surfaceSelections: original.surfaceSelections,
      sample(atMs) {
        // Startup has already occurred. B owns the returned evaluator before
        // calling sample, so its existing finally handles a failed identity gate.
        if (!checked) {
          verifySelection(original.surfaceSelections, declaration.shapes);
          checked = true;
        }
        return original.sample.call(original, atMs);
      },
      dispose() {
        original.dispose.call(original);
      },
    };
  };
  const result = await bakeMeasuredJoint(
    {
      sourceBytes,
      clipName: declaration.clipId,
      shapes: declaration.shapes,
      rootPolicy: declaration.rootPolicy,
      sampleTimesMs: declaration.schedule.sampleKeysMs,
      receipt: input.receipt,
      bakeInput: {
        clipId: clipId(declaration.clipId),
        category: declaration.category,
        durationMs: durationMs(declaration.durationMs),
        sampleRateHz: declaration.schedule.sampleRateHz,
        sourceTimesMs: declaration.sourceTimesSeconds.map(
          (time) => time * 1000,
        ),
        impacts: declaration.impacts,
        ownership: declaration.ownership,
      },
    },
    checkedFactory,
  );
  // Also fail closed if a custom evaluator changed its selection during sampling.
  verifySelection(result.surfaceSelections, declaration.shapes);
  return {
    ...result,
    declaration,
    receipt: input.receipt,
    selectionVerification: Object.freeze({
      gate: 'before-first-sample-after-startup' as const,
      selectedVertexCount: 2284,
      identity:
        'pinned-rendered-vertex-indices-and-source-mesh-primitive' as const,
      acceptance: null,
    }),
  };
}

/** Offline candidate only. No CLI, publication, runtime activation or acceptance. */
import { createHash } from 'node:crypto';
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readButterflyKickCollisionCandidate } from './butterflyKickCollisionCandidate';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';

// Raw rendered-index first appearance; dominant max weight uses first slot on ties.
// Independent L joints47/48 and R51/52; foot+toe is a developer choice.
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
  [
    {
      count: 615,
      hash: '994b4cf8aa18e08ec78f12bba339d8802669f589f31c7a57f38bbb691ef115d3',
    },
    {
      count: 440,
      hash: 'a2e4efcc3ccd20c009195e70282f07818faf386e7aa026c9b32e5662e982918d',
    },
    {
      count: 386,
      hash: '4acd9dc0a84833b1282b0719403550e9255e44837ad09808db3c0fe277e17473',
    },
    {
      count: 588,
      hash: '25bc4c5d0dadb73313de75462a6cbc0808bdbc011e862a40199627e24d442a1f',
    },
    {
      count: 255,
      hash: '87f98f1e9798f28ad88b9889211afb985c8eceada22c614f5c626fe764c73a39',
    },
  ],
] as const;
function verifySelection(
  selections: SourceEvaluator['surfaceSelections'],
  shapes: readonly { shapeId: string; bone: string }[],
) {
  if (selections.length !== 2 || shapes.length !== 2)
    throw new Error('ButterflyKick selection identity mismatch');
  shapes.forEach((shape, side) => {
    const selected = selections[side];
    if (
      !selected ||
      selected.shapeId !== shape.shapeId ||
      selected.bone !== shape.bone ||
      selected.meshes.length !== 5
    )
      throw new Error('ButterflyKick selection identity mismatch');
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
        throw new Error('ButterflyKick selection provenance/vertex mismatch');
    });
  });
}

export async function bakeButterflyKickCollisionCandidate(
  input: {
    readonly sourceBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly receipt: MeasuredJointReceipt;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const sourceBytes = new Uint8Array(input.sourceBytes);
  const declaration = readButterflyKickCollisionCandidate({
    sourceBytes,
    manifestBytes: new Uint8Array(input.manifestBytes),
  });
  if (
    input.receipt.maxSourceUpdates > declaration.schedule.maximumSourceUpdates
  )
    throw new RangeError('ButterflyKick source budget exceeds fixed ceiling');
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
        clipId: declaration.clipId,
        category: declaration.category,
        durationMs: declaration.durationMs,
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
      selectedVertexCount: 4568,
      identity:
        'pinned-rendered-vertex-indices-and-source-mesh-primitive' as const,
      acceptance: null,
    }),
  };
}

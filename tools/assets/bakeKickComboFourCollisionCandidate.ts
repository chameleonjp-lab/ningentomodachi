/** Offline candidate only. No CLI, publication, runtime activation or acceptance. */
import { createHash } from 'node:crypto';
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readKickComboFourCollisionCandidate } from './kickComboFourCollisionCandidate';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';

// SHA256(JSON.stringify(vertexIndices)), retaining rendered first-index order.
// Independently decoded from the pinned mesh 0 index/JOINTS_0/WEIGHTS_0 accessors;
// joint 51 (foot.R, node 48) and descendant 52 (toe.R, node 47), first-weight tie.
const selectionPins = Object.freeze([
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
]);
function verifySelection(
  selections: SourceEvaluator['surfaceSelections'],
  shapeId: string,
) {
  const selected = selections[0];
  if (
    selections.length !== 1 ||
    !selected ||
    selected.shapeId !== shapeId ||
    selected.bone !== 'foot.R' ||
    selected.meshes.length !== 5
  )
    throw new Error('KickCombo4 selection identity mismatch');
  const meshes = [...selected.meshes].sort(
    (a, b) => (a.sourcePrimitiveIndex ?? -1) - (b.sourcePrimitiveIndex ?? -1),
  );
  meshes.forEach((mesh, primitive) => {
    const pin = selectionPins[primitive];
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
      throw new Error('KickCombo4 selection provenance/vertex mismatch');
  });
}

export async function bakeKickComboFourCollisionCandidate(
  input: {
    readonly sourceBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly receipt: MeasuredJointReceipt;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const sourceBytes = new Uint8Array(input.sourceBytes);
  const declaration = readKickComboFourCollisionCandidate({
    sourceBytes,
    manifestBytes: new Uint8Array(input.manifestBytes),
  });
  if (
    input.receipt.maxSourceUpdates > declaration.schedule.maximumSourceUpdates
  )
    throw new RangeError('KickCombo4 source budget exceeds fixed ceiling');
  const shapeId = declaration.shapes[0]?.shapeId;
  if (!shapeId) throw new Error('Missing declared foot shape');
  const checkedFactory: typeof createSourceEvaluator = async (...args) => {
    const original = await evaluatorFactory(...args);
    let checked = false;
    return {
      surfaceSelections: original.surfaceSelections,
      sample(atMs) {
        // Startup has already occurred. B owns the returned evaluator before
        // calling sample, so its existing finally handles a failed identity gate.
        if (!checked) {
          verifySelection(original.surfaceSelections, shapeId);
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
  verifySelection(result.surfaceSelections, shapeId);
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

/** Offline candidate only. No CLI, publication, runtime activation or acceptance. */
import { createHash } from 'node:crypto';
import { clipId, durationMs } from '../../src/contracts';
import {
  createSourceEvaluator,
  type SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readKungFuAcrobaticComboCollisionCandidate } from './kungFuAcrobaticComboCollisionCandidate';
import {
  bakeMeasuredJoint,
  type MeasuredJointReceipt,
} from './measuredJointBake';

// Raw rendered-index first appearance; dominant max weight uses first slot on ties.
// Only R joints51/52; foot+toe is a developer choice.
const selectionPins = [
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
  if (selections.length !== 1 || shapes.length !== 1)
    throw new Error('KungFuAcrobaticCombo selection identity mismatch');
  shapes.forEach((shape, side) => {
    const selected = selections[side];
    if (
      !selected ||
      selected.shapeId !== shape.shapeId ||
      selected.bone !== shape.bone ||
      selected.meshes.length !== 5
    )
      throw new Error('KungFuAcrobaticCombo selection identity mismatch');
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
        throw new Error(
          'KungFuAcrobaticCombo selection provenance/vertex mismatch',
        );
    });
  });
}

export async function bakeKungFuAcrobaticComboCollisionCandidate(
  input: {
    readonly sourceBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly receipt: MeasuredJointReceipt;
    readonly gate: {
      readonly sourceExecutionReleased: true;
      readonly sourceSha256: string;
      readonly sampleTimesSha256: string;
      readonly modelSha256: string;
      readonly maxSourceUpdates: 2713;
    };
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
) {
  const sourceBytes = new Uint8Array(input.sourceBytes);
  const declaration = readKungFuAcrobaticComboCollisionCandidate({
    sourceBytes,
    manifestBytes: new Uint8Array(input.manifestBytes),
  });
  if (
    !input.gate ||
    input.gate.sourceExecutionReleased !== true ||
    input.gate.sourceSha256 !== declaration.sourcePins.sourceSha256 ||
    input.gate.sampleTimesSha256 !== declaration.schedule.sampleKeysSha256 ||
    input.gate.modelSha256 !== declaration.modelSha256 ||
    input.gate.maxSourceUpdates !== 2713
  )
    throw new Error('Exact candidate execution gate required');
  const r = input.receipt;
  if (
    r.maxSourceUpdates !== 2713 ||
    r.attemptedSourceUpdates !== 0 ||
    r.startupUpdates !== 0 ||
    r.sampleUpdates !== 0 ||
    r.rejectedUpdates !== 0 ||
    r.attemptedTimesMs.length ||
    r.rootQuaternionObservations.length ||
    r.cleanupErrors.length
  )
    throw new RangeError('Fresh exact candidate budget required');
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

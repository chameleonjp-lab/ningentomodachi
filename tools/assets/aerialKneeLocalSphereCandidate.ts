/** Unexecuted developer collision-model declaration. This stage only reads metadata. */
import { createHash } from 'node:crypto';
import {
  AERIAL_KNEE_SOURCE_PINS,
  readAerialKneeSource,
} from './aerialKneeDiagnostic';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function hashTimes(times: readonly number[]) {
  const bytes = new Uint8Array(times.length * 8);
  const view = new DataView(bytes.buffer);
  times.forEach((time, index) => {
    view.setFloat64(index * 8, time, true);
  });
  return createHash('sha256').update(bytes).digest('hex');
}

export function planAerialKneeLocalSphereCandidate(
  input: Parameters<typeof readAerialKneeSource>[0],
) {
  const metadata = readAerialKneeSource(input);
  const event = metadata.events[0];
  if (!event) throw new Error('Missing pinned strike');
  const keys = new Set<number>([
    0,
    ...metadata.sourceTimesSeconds.map((time) => time * 1000),
  ]);
  for (let i = 1; i < Math.ceil((metadata.durationMs * 240) / 1000); i++)
    keys.add((i * 1000) / 240);
  const candidateTimesMs = [...keys].sort((a, b) => a - b);
  const probes = new Set<number>();
  for (let i = 1; i < candidateTimesMs.length; i++) {
    const a = candidateTimesMs[i - 1],
      b = candidateTimesMs[i];
    if (a === undefined || b === undefined)
      throw new Error('Missing proposed key');
    if (a >= event.window.startMs && b <= event.window.endMs) {
      for (const fraction of [0.25, 0.5, 0.75])
        probes.add(a + (b - a) * fraction);
    }
  }
  const probeTimesMs = [...probes].sort((a, b) => a - b);
  const sampleTimesMs = [
    ...new Set([...candidateTimesMs, ...probeTimesMs]),
  ].sort((a, b) => a - b);
  const scheduleHashes = {
    candidateTimesMs:
      'a7c4321ad0d95f219a6b79a04652d2d709fefa7b7742329bc4b6a72a5998048f',
    probeTimesMs:
      'c5c5fdf60c5be8c8a24304090a3e818d40c297de58ba94cfad650c73251fef07',
    sampleTimesMs:
      '1cc6e3f5cf8f6933971c64dadfef74cbe8abaec610e09f07f9fa3331cee5f90c',
  };
  const schedule = { candidateTimesMs, probeTimesMs, sampleTimesMs };
  const counts = {
    candidateTimesMs: 418,
    probeTimesMs: 114,
    sampleTimesMs: 532,
  };
  for (const key of [
    'candidateTimesMs',
    'probeTimesMs',
    'sampleTimesMs',
  ] as const) {
    if (
      schedule[key].length !== counts[key] ||
      hashTimes(schedule[key]) !== scheduleHashes[key]
    )
      throw new Error('Exact proposed timetable mismatch');
  }
  const model = {
    origin: 'developer-selected-collision-model' as const,
    shapeId: 'AerialKnee:knee-local-sphere:0',
    bone: 'shin.R',
    radiusM: 0.08590102228100256,
    measurement:
      'maximum-fixed-corner-distance-to-knee-origin-across-12-cached-poses' as const,
    addedPaddingM: 0,
    sourceAuthoredAnatomy: null,
    evidence: {
      primitive: 0,
      triangle: 14435,
      vertexIds: [10926, 11012, 11008],
      sampleFrames: [1, 11, 17, 18, 26, 29, 31, 39, 40, 47, 48, 66],
      skinJoint: 50,
      vertexWeight: 1,
      cacheSha256:
        '4bb0c6bc87decd3251e755dbf9156cdce003ba57c1721eb42be2d8717d1f1254',
      payloadSha256:
        '090e56bf8410b7bad3f6f7aaaca9726dde709be88c1751b48126244c8e1de95c',
      receiptSha256:
        'f98ddba770cadf3fc3a29b6ff06269d16b305465fbf6d0972e03d8cb6925c715',
    },
    limitation:
      'Three outer-knee corner witnesses support a developer approximation, not whole-knee anatomy or full-foot mesh exclusion. Origin-cap witness p0/t13885 is not used.',
  };
  return freeze({
    schemaVersion: 1,
    status: 'UNEXECUTED_KNEE_LOCAL_SPHERE_PLAN' as const,
    source: AERIAL_KNEE_SOURCE_PINS,
    metadata,
    model,
    modelSha256: createHash('sha256')
      .update(JSON.stringify(model))
      .digest('hex'),
    impact: {
      impactIndex: 0,
      shapeId: 'AerialKnee:knee-local-sphere:0',
      startMs: event.window.startMs,
      endMs: event.window.endMs,
      damageShare: 1,
    },
    proposedOwnership: [
      {
        atMs: 0,
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'authored-root' as const,
      },
    ],
    schedule,
    scheduleHashes,
    proposedBudget: {
      evaluatorInstances: 1,
      startupSourceUpdates: 1,
      sampleCalls: 532,
      totalSourceUpdates: 533,
      selectedVerticesPerSample: 0,
      measuredVertexEvaluations: 0,
      adaptiveRounds: 0,
      rasterCalls: 0,
    },
    expectedSurfaceSelections: [] as const,
    limitations: [
      'This is a schedule/declaration only. No new candidate source poses have been evaluated or baked. Prior corner measurements are evidence only.',
      'A separate exact release and shared lifecycle/cache API are required before any original source evaluation.',
      'Preserve native root XYZ translation, identity STEP root quaternion, and identity STEP pelvis rotation; the authored arch, landing and forward travel must not be flattened.',
      'Finite interpolation residual and empty-space excess are different diagnostics; neither implies gameplay acceptance.',
      'Do not pad, merge narrow patches, change windows, include foot or distal shin, or activate a runtime catalog from this plan.',
    ],
    executionReleased: false,
    executionReceipt: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type AerialKneeLocalSpherePlan = ReturnType<
  typeof planAerialKneeLocalSphereCandidate
>;

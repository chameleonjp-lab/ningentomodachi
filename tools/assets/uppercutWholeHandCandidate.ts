/** Unexecuted developer collision-model declaration. This stage only reads metadata. */
import { createHash } from 'node:crypto';
import { UPPERCUT_SOURCE_PINS, readUppercutSource } from './uppercutDiagnostic';

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

export function planUppercutWholeHandCandidate(
  input: Parameters<typeof readUppercutSource>[0],
) {
  const metadata = readUppercutSource(input);
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
      'f59e2fa09e8c640d2da0876619110c9039a2b6e8697d11a8afe1be411302a417',
    probeTimesMs:
      '873386020b370385db225eb5580dc82c95cc2b48d7c8b35a681a64a95c351d27',
    sampleTimesMs:
      '4e978caacabe7315029b242d678a01ec2c70eb20eb58be9c73849fd331d0a957',
  };
  const schedule = { candidateTimesMs, probeTimesMs, sampleTimesMs };
  const counts = {
    candidateTimesMs: 297,
    probeTimesMs: 75,
    sampleTimesMs: 372,
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
  return freeze({
    schemaVersion: 1,
    status: 'UNEXECUTED_WHOLE_HAND_CANDIDATE_PLAN' as const,
    source: UPPERCUT_SOURCE_PINS,
    metadata,
    model: {
      origin: 'developer-selected-collision-model' as const,
      shapeId: 'Uppercut:whole-hand:0',
      bone: 'hand.R',
      surface: 'dominant-skin-subtree' as const,
      jointIndices: Array.from({ length: 16 }, (_, i) => 29 + i),
      measurement:
        'posed-selected-vertex-AABB-center-plus-farthest-vertex-sphere' as const,
      tiePolicy: 'first-accessor-component' as const,
      includesForearm: false,
      narrowPatchUnion: false,
      addedPaddingM: 0,
      sourceAuthoredAnatomy: null,
      limitation:
        'Dominant-weight rendered-vertex cluster, not exact anatomical segmentation or an accepted contact surface.',
    },
    impact: {
      impactIndex: 0,
      shapeId: 'Uppercut:whole-hand:0',
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
      sampleCalls: 372,
      totalSourceUpdates: 373,
      selectedVerticesPerSample: 4223,
      measuredVertexEvaluations: 1570956,
      adaptiveRounds: 0,
      rasterCalls: 0,
    },
    expectedSelection: {
      status: 'raw-accessor-derived-expectation-not-evaluator-receipt' as const,
      hashEncoding: 'rendered-reference-order-uint32-little-endian' as const,
      sourceMeshIndex: 0,
      primitives: [
        {
          index: 0,
          count: 1513,
          sha256:
            'dc13229a4b5b059af10a7b0ef3a5c736669090f0d3733fdeb326cb84c13aea35',
        },
        {
          index: 1,
          count: 122,
          sha256:
            '3f2cd4c3ac9d6708cd3e697a146c6654b72ee51596b88a3d7ae5e72aacde7555',
        },
        {
          index: 2,
          count: 1676,
          sha256:
            'd181aeb9d8a089f36c5f9a645d492ce5c42f425a587c3dc1761a5734809696db',
        },
        {
          index: 3,
          count: 912,
          sha256:
            'f8907c907f24228de47d3e621a50c1025313c5a0c29b5a7553975ef7bc06ed1d',
        },
        {
          index: 4,
          count: 0,
          sha256:
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    },
    limitations: [
      'This is a schedule/declaration only. No candidate geometry has been evaluated or baked.',
      'A separate exact release and shared lifecycle/cache API are required before any original source evaluation.',
      'Preserve native root XYZ translation, identity STEP root quaternion, and nonidentity pelvis rotation; net-zero displacement does not authorize flattening.',
      'Finite interpolation residual and empty-space excess are different diagnostics; neither implies gameplay acceptance.',
      'Do not pad, merge narrow patches, change windows, include forearm, or activate a runtime catalog from this plan.',
    ],
    executionReleased: false,
    executionReceipt: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type UppercutWholeHandPlan = ReturnType<
  typeof planUppercutWholeHandCandidate
>;

/** Unexecuted developer collision-model declaration. This stage only reads metadata. */
import { createHash } from 'node:crypto';
import {
  CHINESE_AERIAL_KNEE_SOURCE_PINS,
  readChineseAerialKneeSource,
} from './chineseAerialKneeDiagnostic';

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

export function planChineseAerialKneeLocalSphereCandidate(
  input: Parameters<typeof readChineseAerialKneeSource>[0],
) {
  const metadata = readChineseAerialKneeSource(input);
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
      '5bc1c5d7cc19cd2f9fa73cadbbe0cc8cfae62e161427e434dd2d6bbf69be2af6',
    probeTimesMs:
      '54d1eeb368cd7e355e871050821601837a4a0e82ec10d812be4d494ea9d13eff',
    sampleTimesMs:
      '293049bcad628d9e5f680970ba408945274f47ca80f8c531156bd99f5dcabfde',
  };
  const schedule = { candidateTimesMs, probeTimesMs, sampleTimesMs };
  const counts = {
    candidateTimesMs: 532,
    probeTimesMs: 114,
    sampleTimesMs: 646,
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
    shapeId: 'ChineseAerialKnee:knee-local-sphere:0',
    bone: 'shin.R',
    radiusM: 0.08590105297158424,
    measurement:
      'maximum-fixed-corner-distance-to-knee-origin-across-84-native-cached-poses' as const,
    addedPaddingM: 0,
    sourceAuthoredAnatomy: null,
    continuousEnclosureVerified: false,
    inheritedRadiusM: 0.08590102228100256,
    deltaFromInheritedM: 3.0690581673264994e-8,
    scalePolicy: 'native-nonunit-scales-retained',
    evidence: {
      primitive: 0,
      triangle: 14435,
      vertexIds: [10926, 11012, 11008],
      sampleFrames: Array.from({ length: 84 }, (_, i) => i + 1),
      skinJoint: 50,
      vertexWeight: 1,
      cacheSha256:
        '694c58f1a2e26e1278eb7394907bd038d6755cc0011bf77f62eae6725a707154',
      payloadSha256:
        '1a5f9209b83c6fefc85dcdcbebfe13d1ab08ab210d547c280989bc4bf942e01a',
      receiptSha256:
        'bde10401b138cf6a250d878573f3d8c5ee0fb44e872a11fafa7d36b62e5edd19',
    },
    limitation:
      'Three outer-knee corner witnesses across84native poses support a developer approximation, not continuous enclosure, whole-knee anatomy or full-foot mesh exclusion. The tiny numerical radius difference is not evidence of a material visual change. Origin-cap witness p0/t13885 is not used.',
  };
  return freeze({
    schemaVersion: 1,
    status: 'UNEXECUTED_KNEE_LOCAL_SPHERE_PLAN' as const,
    source: CHINESE_AERIAL_KNEE_SOURCE_PINS,
    metadata,
    model,
    modelSha256: createHash('sha256')
      .update(JSON.stringify(model))
      .digest('hex'),
    impact: {
      impactIndex: 0,
      shapeId: 'ChineseAerialKnee:knee-local-sphere:0',
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
      sampleCalls: 646,
      totalSourceUpdates: 647,
      selectedVerticesPerSample: 0,
      measuredVertexEvaluations: 0,
      adaptiveRounds: 0,
      rasterCalls: 0,
    },
    expectedSurfaceSelections: [] as const,
    limitations: [
      'This is a schedule/declaration only. No new candidate source poses have been evaluated or baked. Prior ChineseAerialKnee corner measurements are evidence only; no new candidate evaluation has run.',
      'A separate exact release and shared lifecycle/cache API are required before any original source evaluation.',
      'Preserve native root XYZ translation, native LINEAR root quaternion with nonmonotonic heading, and identity STEP pelvis rotation; the authored arch, landing and forward travel must not be flattened.',
      'Finite interpolation residual and empty-space excess are different diagnostics; neither implies gameplay acceptance.',
      'Do not pad, merge narrow patches, change windows, include foot or distal shin, or activate a runtime catalog from this plan.',
    ],
    executionReleased: false,
    executionReceipt: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type ChineseAerialKneeLocalSpherePlan = ReturnType<
  typeof planChineseAerialKneeLocalSphereCandidate
>;

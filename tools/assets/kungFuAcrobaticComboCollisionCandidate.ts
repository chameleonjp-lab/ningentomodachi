/** Source0 developer declaration; three right-foot impacts, not authored anatomy or acceptance. */
import { createHash } from 'node:crypto';
import { durationMs } from '../../src/contracts';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import {
  readKungFuAcrobaticComboSource,
  KUNG_FU_ACROBATIC_COMBO_SOURCE_PINS,
} from './kungFuAcrobaticComboDiagnostic';
function freeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}
export function readKungFuAcrobaticComboCollisionCandidate(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const source = readKungFuAcrobaticComboSource(input),
    pins = KUNG_FU_ACROBATIC_COMBO_SOURCE_PINS;
  const shapes = [
    {
      shapeId: 'KungFuAcrobaticCombo:right-foot:dominant-subtree:collision-v1',
      bone: 'foot.R',
      surface: 'dominant-skin-subtree' as const,
    },
  ];
  const impacts = source.events.map((e, i) => {
    const shape = shapes[0];
    if (!shape) throw new Error('Missing separate foot shape');
    return {
      impactIndex: i,
      impactId: e.impactId,
      startMs: durationMs(e.window.startMs),
      endMs: durationMs(e.window.endMs),
      damageShare: 1 / 3,
      shapeId: shape.shapeId,
    };
  });
  const keys = new Set<number>([
    0,
    source.durationMs,
    ...source.sourceTimesSeconds.map((t) => t * 1000),
    ...impacts.flatMap((i) => [i.startMs, i.endMs]),
  ]);
  for (let i = 1; i < Math.ceil((source.durationMs * 240) / 1000); i++)
    keys.add((i * 1000) / 240);
  const baseKeysMs = [...keys].sort((a, b) => a - b),
    activeIntervals: [number, number][] = [];
  for (let i = 1; i < baseKeysMs.length; i++) {
    const a = baseKeysMs[i - 1],
      b = baseKeysMs[i];
    if (a === undefined || b === undefined) throw new Error('Missing key');
    if (impacts.some((x) => a >= x.startMs && b <= x.endMs))
      activeIntervals.push([a, b]);
  }
  const probeKeysMs = [
    ...new Set(
      activeIntervals.flatMap(([a, b]) =>
        [0.25, 0.5, 0.75].map((f) => a + (b - a) * f),
      ),
    ),
  ].sort((a, b) => a - b);
  const sampleKeysMs = [...new Set([...baseKeysMs, ...probeKeysMs])].sort(
    (a, b) => a - b,
  );
  if (
    baseKeysMs.length !== 1314 ||
    activeIntervals.length !== 466 ||
    probeKeysMs.length !== 1398 ||
    sampleKeysMs.length !== 2712 ||
    sampleKeysMs.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t < 0 ||
        t > source.durationMs ||
        (i > 0 && t <= (sampleKeysMs[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact KungFuAcrobaticCombo schedule required');
  const bytes = Buffer.alloc(sampleKeysMs.length * 8);
  sampleKeysMs.forEach((t, i) => {
    bytes.writeDoubleLE(t, i * 8);
  });
  const sampleKeysSha256 = createHash('sha256').update(bytes).digest('hex');
  if (
    sampleKeysSha256 !==
    '306b1bbb7f0746222d3136ac32cc81a08697341dc6de0292d850297663ee2caf'
  )
    throw new Error('Exact schedule hash required');
  const model = {
    status: 'developer-selected-unaccepted' as const,
    origin: 'developer-collision-abstraction' as const,
    selection: 'right-whole-foot-subtree' as const,
    primitive: 'posed-cluster-enclosing-sphere' as const,
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
    expectedCountsPerPrimitive: [615, 440, 386, 588, 255],
    expectedSelectedVertexCount: 2284,
    limitation:
      'Developer-selected dominant skin cluster, not authored anatomy/contact. Intended hit, near miss, clash and device acceptance remain unverified.',
  };
  const modelSha256 = createHash('sha256')
    .update(JSON.stringify(model))
    .digest('hex');
  return freeze({
    ...source,
    sourceStage: { model: source.model, geometryPolicy: source.geometryPolicy },
    geometryPolicy: 'developer-selected-whole-right-foot-unaccepted' as const,
    modelSha256,
    sourcePins: pins,
    category: 'kick' as const,
    shapes,
    impacts,
    damageShareOrigin:
      'provisional-developer-balancing-not-source-fact' as const,
    model,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'KungFuAcrobaticCombo',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/18',
        supportPointer: '/clips/18/support_contacts',
      },
    }),
    rootTransformRequirement: {
      extractedTransport: 'full-authored-xyz-relative-to-startup',
      geometryCenter: 'world-measured-center-minus-extracted-root',
      reconstruction: 'relative-center-plus-extracted-root-exactly-once',
      nativeQuaternion:
        'full-native-quaternion-pitch-roll-yaw-retained-in-measured-geometry',
      yawProjectionIsAuthoredHeading: false,
      scalarYaw: 'observational-only-never-reapplied-to-measured-geometry',
    },
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'authored-root' as const,
      },
    ],
    schedule: {
      sampleRateHz: 240,
      baseKeysMs,
      activeIntervals,
      probeKeysMs,
      sampleKeysMs,
      sampleKeysSha256,
      startupUpdates: 1,
      maximumSourceUpdates: 2713,
      maximumMeasuredVertexEvaluations: 6194208,
      maximumSphereMeasurements: 2712,
      adaptiveCalls: 0,
      probeLimitation:
        'Finite fixed probes only; not continuous or gameplay acceptance.',
    },
    sourceFineAnatomyAcceptance: null,
    sourceAuthoredAnatomy: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

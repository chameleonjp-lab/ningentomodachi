/** Source0 developer declaration; two separate feet, not authored anatomy or acceptance. */
import { createHash } from 'node:crypto';
import { durationMs } from '../../src/contracts';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import {
  readButterflyKickSource,
  BUTTERFLY_KICK_SOURCE_PINS,
} from './butterflyKickDiagnostic';
function freeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}
export function readButterflyKickCollisionCandidate(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const source = readButterflyKickSource(input),
    pins = BUTTERFLY_KICK_SOURCE_PINS;
  const shapes = [
    {
      shapeId: 'ButterflyKick:left-foot:dominant-subtree:collision-v1',
      bone: 'foot.L',
      surface: 'dominant-skin-subtree' as const,
    },
    {
      shapeId: 'ButterflyKick:right-foot:dominant-subtree:collision-v1',
      bone: 'foot.R',
      surface: 'dominant-skin-subtree' as const,
    },
  ];
  const impacts = source.events.map((e, i) => {
    const shape = shapes[i];
    if (!shape) throw new Error('Missing separate foot shape');
    return {
      impactIndex: i,
      startMs: durationMs(e.window.startMs),
      endMs: durationMs(e.window.endMs),
      damageShare: 0.5,
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
    baseKeysMs.length !== 557 ||
    activeIntervals.length !== 76 ||
    probeKeysMs.length !== 228 ||
    sampleKeysMs.length !== 785 ||
    sampleKeysMs.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t < 0 ||
        t > source.durationMs ||
        (i > 0 && t <= (sampleKeysMs[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact ButterflyKick schedule required');
  const bytes = Buffer.alloc(sampleKeysMs.length * 8);
  sampleKeysMs.forEach((t, i) => {
    bytes.writeDoubleLE(t, i * 8);
  });
  const sampleKeysSha256 = createHash('sha256').update(bytes).digest('hex');
  return freeze({
    ...source,
    sourceStageModelStatus: source.candidateModelStatus,
    sourceStageCompletionPath: source.completionPath,
    candidateModelStatus: 'developer-selected-unaccepted',
    completionPath:
      'Two separate developer-selected whole-foot candidates require source measurement, then separate visual and quantitative gates. No gameplay acceptance or production admission.',
    sourcePins: pins,
    category: 'kick' as const,
    shapes,
    impacts,
    damageShareOrigin:
      'provisional-developer-balancing-not-source-fact' as const,
    model: {
      origin: 'developer-collision-abstraction' as const,
      selection: 'separate-left-and-right-whole-foot-subtrees' as const,
      primitive: 'posed-cluster-enclosing-sphere' as const,
      includesToe: true,
      includesShin: false,
      includesThigh: false,
      shapeUnion: false,
      expectedCountsPerPrimitive: [615, 440, 386, 588, 255],
      expectedCountPerSide: 2284,
      limitation:
        'Foot plus descendant toe is a developer-selected skin cluster, not source-authored anatomy or a unique contact patch. Each side remains a separate curve; visual, intended-hit, near-miss and clash gates remain required.',
    },
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'ButterflyKick',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/15',
        supportPointer: '/clips/15/support_contacts/support_contacts',
      },
    }),
    rootTransformRequirement: {
      ...source.rootTransformRequirement,
      extractedTransport: 'D=raw-world-root-minus-startup-origin',
      reconstruction:
        'C_local=posed-world-sphere-minus-D; rootCurve=D; world=C_local+D exactly once; no scalar-yaw rotation',
      nativeXYZAndQuaternion:
        'full-native-quaternion-in-world-geometry; XYZ-displacement-extracted-to-authored-root-once',
      scalarYaw: 'observational-projection-not-heading',
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
      maximumSourceUpdates: 786,
      maximumMeasuredVertexEvaluations: 3585880,
      maximumSphereMeasurements: 1570,
      adaptiveCalls: 0,
      probeLimitation:
        'Finite fixed probes only; not continuous or gameplay acceptance.',
    },
    sourceFineAnatomyAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

/** Developer-selected lowerleg model; nine-pose evidence is not all-native geometry acceptance. */
import { createHash } from 'node:crypto';
import { durationMs } from '../../src/contracts';
import { readKungFuSweepSource } from './kungFuSweepDiagnostic';
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function readKungFuSweepLowerLegCandidate(
  input: Parameters<typeof readKungFuSweepSource>[0],
) {
  const metadata = readKungFuSweepSource(input),
    event = metadata.events[0];
  if (!event) throw new Error('Missing exact sweep event');
  const shapeId = 'KungFuSweep:right-lowerleg:measured-capsule-v1';
  const impacts = [
    {
      impactIndex: 0,
      startMs: durationMs(event.window.startMs),
      endMs: durationMs(event.window.endMs),
      damageShare: 1,
      shapeId,
    },
  ];
  const keys = new Set<number>([
    0,
    metadata.durationMs,
    ...metadata.sourceTimesSeconds.map((t) => t * 1000),
    event.window.startMs,
    event.window.endMs,
  ]);
  for (let i = 1; i < Math.ceil((metadata.durationMs * 240) / 1000); i++)
    keys.add((i * 1000) / 240);
  const baseKeysMs = [...keys].sort((a, b) => a - b),
    activeIntervals: [number, number][] = [];
  for (let i = 1; i < baseKeysMs.length; i++) {
    const a = baseKeysMs[i - 1],
      b = baseKeysMs[i];
    if (a === undefined || b === undefined)
      throw new Error('Missing schedule key');
    if (a >= event.window.startMs && b <= event.window.endMs)
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
  const packed = Buffer.alloc(sampleKeysMs.length * 8);
  sampleKeysMs.forEach((t, i) => {
    packed.writeDoubleLE(t, i * 8);
  });
  const sampleKeysSha256 = createHash('sha256').update(packed).digest('hex');
  if (
    baseKeysMs.length !== 493 ||
    activeIntervals.length !== 120 ||
    probeKeysMs.length !== 360 ||
    sampleKeysMs.length !== 853 ||
    sampleKeysSha256 !==
      '9d0a15b764e2d9afb57fb458abf73d2b80aeb01a73ca0382182a00aa094bdcd1'
  )
    throw new Error('Exact KungFuSweep schedule required');
  return freeze({
    ...metadata,
    category: 'kick' as const,
    impacts,
    shapeId,
    model: {
      origin: 'developer-collision-abstraction' as const,
      kind: 'capsule' as const,
      startBone: 'shin.R',
      endBone: 'foot.R',
      radiusM: 0.08922894361606443,
      paddingM: 0,
      includesFoot: false,
      includesToe: false,
      observedPoseCount: 9,
      allNativeGeometryCoverage: null,
      acceptance: null,
      sourceCacheSha256:
        '6bbaba001b1d52641269f4c21a7d2a7ee2163718879bc28beefe851f65c131d4',
      measurementSha256:
        '284a894d665a2a1f0876200baa7b88bcf3c6f816b001f4fdc3024462c31b2865',
      limitation:
        'Radius is the nine-pose shin-dominant vertex maximum, not an anatomy certificate. Foot/toe geometry is not admitted; incidental spatial overlap is not a foot exclusion guarantee. Full-native geometry and gameplay acceptance remain unverified.',
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
      maximumSourceUpdates: 854,
      maximumJointOriginObservations: 1706,
      maximumCapsuleConversions: 853,
      sourceGeometryEvaluations: 0,
      adaptiveCalls: 0,
      probeLimitation:
        'Finite quarter/mid/three-quarter probes only, not continuous certification.',
    },
    damageShareOrigin:
      'provisional-developer-balancing-not-source-fact' as const,
    acceptance: null,
    gameplayAllowance: null,
  });
}

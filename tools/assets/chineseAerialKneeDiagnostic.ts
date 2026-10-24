/** Metadata-only ChineseAerialKnee descriptor; no region recipe or production admission. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';
export const CHINESE_AERIAL_KNEE_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const CHINESE_AERIAL_KNEE_NATIVE_TIMES_SHA256 =
  '4b2bf1265a9c9ab105b12fb90fa851d9405776ee1e4d81c5d03281e9d80e881e';
const SCALE_CHAIN = [
  {
    node: 52,
    accessor: 679,
    interpolation: 'STEP',
    sha256: 'f46913286d895f62d646314f400fc3d7a543cf34eb4ae56df87f43dc4582a36b',
    endpoints: [
      [1.0, 1.0, 1.0],
      [1.0, 1.0, 1.0],
    ],
  },
  {
    node: 51,
    accessor: 682,
    interpolation: 'STEP',
    sha256: 'f46913286d895f62d646314f400fc3d7a543cf34eb4ae56df87f43dc4582a36b',
    endpoints: [
      [1.0, 1.0, 1.0],
      [1.0, 1.0, 1.0],
    ],
  },
  {
    node: 50,
    accessor: 826,
    interpolation: 'LINEAR',
    sha256: 'b1e99deff4f84b61e6c5fc16654e8ca552f2c5fd28901109b0d36b1206eb1643',
    endpoints: [
      [0.9999998211860657, 0.9999999403953552, 1.0],
      [0.9999992847442627, 0.9999997019767761, 1.0000008344650269],
    ],
  },
  {
    node: 49,
    accessor: 829,
    interpolation: 'LINEAR',
    sha256: 'ec52e5cb863727133a09b57696ac457face35ac743ce86ed2c5a99792e08b1cf',
    endpoints: [
      [1.0, 1.000000238418579, 0.9999997615814209],
      [0.9999996423721313, 1.0000007152557373, 1.0],
    ],
  },
] as const;
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Source object required');
  return value as Record<string, unknown>;
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Source array required');
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function validateChineseAerialKneeAccessorTimes(
  times: readonly number[],
) {
  if (
    times.length !== 84 ||
    times.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t !== Math.fround(t) ||
        t <= 0 ||
        (i > 0 && t <= (times[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((t, i) => {
    view.setFloat32(i * 4, t, true);
  });
  if (hash(bytes) !== CHINESE_AERIAL_KNEE_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readChineseAerialKneeSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = CHINESE_AERIAL_KNEE_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('ChineseAerialKnee source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  const source = record(list(manifest.clips)[17]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    source.clip !== 'ChineseAerialKnee' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,84]' ||
    events.length !== 1 ||
    event.type !== 'forward/upward knee' ||
    event.limb !== 'right knee / shin.R head' ||
    JSON.stringify(event.frames) !== '[34,39]' ||
    event.peak_frame !== 37 ||
    event.foot_is_not_strike_surface !== true
  )
    throw new Error('Exact ChineseAerialKnee source event required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'ChineseAerialKnee',
  );
  if (!binary) throw new Error('Source animation required');
  validateChineseAerialKneeAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.8666666746139526)
    throw new Error('Native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 84,
    fps: 45,
    firstFrame: 34,
    lastFrame: 39,
    peakFrame: 37,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  return freeze({
    clipId: clipId('ChineseAerialKnee'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/17',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/17',
      fullTimeAccessorPointer: '/accessors/675',
      endpointAccessorPointer: '/accessors/678',
      nativeTimesSha256: CHINESE_AERIAL_KNEE_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'shin.R',
        side: 'R',
        sourceFrames: [34, 39] as const,
        peakFrame: 37,
        sourceEventPointer:
          '/clips/17/attack_and_timeline_events/attack_events/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: null,
        acceptance: null,
      },
    ],
    sourceRoot: source.root_motion,
    sourceSupport: source.support_contacts,
    sourcePhases: source.phases,
    sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'ChineseAerialKnee',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/17',
        supportPointer: '/clips/17/support_contacts/support_phases',
      },
    }),
    // Exact source byte pins bind all listed channels and hierarchy. No geometry is chosen here.
    rootTransformRequirement: {
      rootNode: 52,
      pelvisNode: 51,
      parentNode: 54,
      parentTranslation: [0, -0.02199999988079071, 0],
      translationAccessor: 676,
      quaternionAccessor: 677,
      pelvisTranslationAccessor: 680,
      pelvisQuaternionAccessor: 681,
      shinNode: 49,
      shinSkinJoint: 50,
      shinTranslationAccessor: 827,
      shinQuaternionAccessor: 828,
      translationAccessorSha256:
        'f98b48c01eeda003ecde37c76f814947714c12f0081b5b7872d5299c552f2e39',
      quaternionAccessorSha256:
        '25bb32fb58b08c61bf4cda8fd0c1340dbcc9bcadb4e0ca102ac9ec28da333baf',
      shinQuaternionAccessorSha256:
        '5e268b61f5714451aa7342f3774777a32e8c0ac0e29af9d29e03aae18fda9043',
      translationAxes: ['x', 'y', 'z'] as const,
      rootRotationInterpolation: 'LINEAR' as const,
      rootQuaternionEndpoints: [
        [0, 0, 0, 1],
        [0, 0.3826834559440613, 0, 0.9238795042037964],
      ],
      rootYawRangeRadians: [-0.07999999413967027, 0.8800005469296825],
      rootYawMaximumFrame: 57,
      rootYawFinalRadians: 0.7853982286313229,
      pelvisRotationInterpolation: 'STEP' as const,
      pelvisQuaternionEndpoints: [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
      scaleChain: SCALE_CHAIN,
      scalePolicy: 'preserve-native-nonunit-linear-scales; do-not-normalize',
      rootRotationPolicy:
        'retain-native-quaternion; not-monotonic-final-heading-interpolation',
      initialHoldMs: 22.22222276031971,
      preserveAllAnimationChannels: true,
      endReset: false,
      applyOrExtractExactlyOnce: true,
      acceptance: null,
    },
    geometryReference: {
      status: 'reference-only-not-selected' as const,
      inverseBindAccessor: 30,
      inverseBindSha256:
        '8ce7000c4c625d9d7275093d3d223635d80054b50a4c3fdb6a21054fdb65824a',
      primitive: 0,
      triangle: 14435,
      vertexIds: [10926, 11012, 11008],
      skinJoint: 50,
      node: 49,
      weight: 1,
      inheritedMeasurementClip: 'AerialKnee',
      inheritedMeasurementRadiusM: 0.08590102228100256,
      inheritedCacheSha256:
        '4bb0c6bc87decd3251e755dbf9156cdce003ba57c1721eb42be2d8717d1f1254',
      inheritedPayloadSha256:
        '090e56bf8410b7bad3f6f7aaaca9726dde709be88c1751b48126244c8e1de95c',
      inheritedReceiptSha256:
        'f98ddba770cadf3fc3a29b6ff06269d16b305465fbf6d0972e03d8cb6925c715',
      exactScaleIdentity: false,
      selectedRadiusM: null,
      enclosureVerified: false,
      acceptance: null,
      limitation:
        'Shared bind geometry only. Native thigh/shin scales differ from AerialKnee. Prior radius is not a measured ChineseAerialKnee radius, guaranteed enclosure, selected collision region, or acceptance.',
    },
    regionChoice: null,
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type ChineseAerialKneeDescriptor = ReturnType<
  typeof readChineseAerialKneeSource
>;

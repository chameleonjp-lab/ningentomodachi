/** Metadata-only AerialKnee descriptor; no region recipe or production admission. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';
export const AERIAL_KNEE_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const AERIAL_KNEE_NATIVE_TIMES_SHA256 =
  '5ae7ed54f97883d9e869bbf9da0845c560cda7711655611486664f814af37063';
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
export function validateAerialKneeAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 66 ||
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
  if (hash(bytes) !== AERIAL_KNEE_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readAerialKneeSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = AERIAL_KNEE_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('AerialKnee source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  const source = record(list(manifest.clips)[6]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    source.clip !== 'AerialKnee' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,66]' ||
    events.length !== 1 ||
    event.type !== 'upward/forward knee' ||
    event.limb !== 'shin.R head / right knee' ||
    JSON.stringify(event.frames) !== '[26,31]' ||
    event.peak_frame !== 29 ||
    event.foot_is_not_strike_surface !== true
  )
    throw new Error('Exact AerialKnee source event required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'AerialKnee',
  );
  if (!binary) throw new Error('Source animation required');
  validateAerialKneeAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.4666666984558105)
    throw new Error('Native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 66,
    fps: 45,
    firstFrame: 26,
    lastFrame: 31,
    peakFrame: 29,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  return freeze({
    clipId: clipId('AerialKnee'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/6',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/6',
      fullTimeAccessorPointer: '/accessors/192',
      endpointAccessorPointer: '/accessors/194',
      nativeTimesSha256: AERIAL_KNEE_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'shin.R',
        side: 'R',
        sourceFrames: [26, 31] as const,
        peakFrame: 29,
        sourceEventPointer:
          '/clips/6/attack_and_timeline_events/attack_events/0',
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
      clipId: 'AerialKnee',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/6',
        supportPointer: '/clips/6/support_contacts/support_phases',
      },
    }),
    // Exact source byte pins bind all listed channels and hierarchy. No geometry is chosen here.
    rootTransformRequirement: {
      rootNode: 52,
      pelvisNode: 51,
      parentNode: 54,
      parentTranslation: [0, -0.02199999988079071, 0],
      translationAccessor: 193,
      quaternionAccessor: 195,
      pelvisTranslationAccessor: 197,
      pelvisQuaternionAccessor: 198,
      shinNode: 49,
      shinSkinJoint: 50,
      shinTranslationAccessor: 344,
      shinQuaternionAccessor: 345,
      translationAccessorSha256:
        '1e70fed6397468f16adc083925ac2f9b9b0d2d742a89fef5d5679332597dae20',
      quaternionAccessorSha256:
        'bf2022dccf9d8fba203301d60bd02bc2f5a8ad2b80747468c8cd27115ff848a3',
      shinQuaternionAccessorSha256:
        'fdfc1a607cc41aa20d4f07e406bfdc8f4dc611691d57946391818047b1831ef9',
      translationAxes: ['x', 'y', 'z'] as const,
      rootRotationInterpolation: 'STEP' as const,
      rootQuaternionEndpoints: [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
      preserveAllAnimationChannels: true,
      endReset: false,
      applyOrExtractExactlyOnce: true,
      acceptance: null,
    },
    regionChoice: null,
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type AerialKneeDescriptor = ReturnType<typeof readAerialKneeSource>;

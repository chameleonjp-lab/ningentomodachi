/** Metadata-only KungFuSweep descriptor; no region recipe or production admission. */
import { createHash } from 'node:crypto';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { inspectGlb } from '../../src/assets/source';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';
export const KUNG_FU_SWEEP_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const KUNG_FU_SWEEP_NATIVE_TIMES_SHA256 =
  'f7cf632f6e1e453d4b6c113b33e465624b70eae1c58a8792b55789d75c1f332a';
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
export function validateKungFuSweepAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 78 ||
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
  if (hash(bytes) !== KUNG_FU_SWEEP_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readKungFuSweepSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = KUNG_FU_SWEEP_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('KungFuSweep source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  const source = record(list(manifest.clips)[11]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    source.clip !== 'KungFuSweep' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    source.original_source_fps !== 30 ||
    JSON.stringify(source.source_frame_range) !== '[1,78]' ||
    events.length !== 1 ||
    event.type !== 'right low sweeping leg' ||
    JSON.stringify(event.frames) !== '[26,44]' ||
    event.impact_frame !== 35
  )
    throw new Error('Exact KungFuSweep source event required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'KungFuSweep',
  );
  if (!binary) throw new Error('Source animation required');
  validateKungFuSweepAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.7333332300186157)
    throw new Error('Native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 78,
    fps: 45,
    firstFrame: 26,
    lastFrame: 44,
    peakFrame: 35,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  return freeze({
    clipId: clipId('KungFuSweep'),
    durationMs: actualDurationMs,
    manifestDurationSeconds: source.seconds,
    speedProvenance: {
      sourceFps: source.fps,
      originalSourceFps: source.original_source_fps,
      bakedSpeedMultiplier: manifest.baked_speed_multiplier,
      runtimePlaybackSpeed: manifest.runtime_playback_speed,
    },
    sourceClipPointer: '/clips/11',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/11',
      fullTimeAccessorPointer: '/accessors/2122',
      endpointAccessorPointer: '/accessors/2124',
      nativeTimesSha256: KUNG_FU_SWEEP_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: null,
        side: 'R',
        sourceFrames: [26, 44] as const,
        peakFrame: 35,
        sourceEventPointer:
          '/clips/11/attack_and_timeline_events/attack_events/0',
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
      clipId: 'KungFuSweep',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/11',
        supportPointer: '/clips/11/support_contacts/support_contacts',
      },
    }),
    // Exact source byte pins bind all listed channels and hierarchy. No geometry is chosen here.
    rootTransformRequirement: {
      rootNode: 52,
      pelvisNode: 51,
      parentNode: 54,
      parentTranslation: [0, -0.02199999988079071, 0],
      translationAccessor: 4044,
      quaternionAccessor: 4045,
      scaleAccessor: 4046,
      pelvisTranslationAccessor: 4047,
      pelvisQuaternionAccessor: 4048,
      translationAccessorSha256:
        'e438792695bf06abe74d523b5226181c12082cc138e2e56e7f9fe689f7148d92',
      quaternionAccessorSha256:
        '1db07bf5bad89562ddb4a0195e4c51ab5404870c85c2e2e64b5982ecdf694faf',
      // Source prose identifies the retained, unwrapped heading. Not gameplay acceptance.
      sourceFinalHeadingRadians: 2.4,
      preserveContinuousAuthoredYaw: true,
      translationAxes: ['x', 'y', 'z'] as const,
      rootRotationInterpolation: 'LINEAR' as const,
      rootQuaternionEndpoints: [
        [0, 0, 0, 1],
        [0, 0.9320391416549683, 0, 0.3623577058315277],
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
export type KungFuSweepDescriptor = ReturnType<typeof readKungFuSweepSource>;

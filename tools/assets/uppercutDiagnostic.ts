/** Metadata-only descriptor. No surface recipe or production admission. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const UPPERCUT_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256:
    'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath:
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256:
    'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export const UPPERCUT_NATIVE_TIMES_SHA256 =
  '23611210e110cae2997cfbaa44f66e91e132a162bd2236061f79803f77ce0b1e';
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
export function validateUppercutAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 47 ||
    times.some(
      (time, i) =>
        !Number.isFinite(time) ||
        time !== Math.fround(time) ||
        time <= 0 ||
        (i > 0 && time <= (times[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((time, i) => {
    view.setFloat32(i * 4, time, true);
  });
  if (hash(bytes) !== UPPERCUT_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readUppercutSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = UPPERCUT_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5584752 ||
    input.manifestBytes.byteLength !== 46217 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Uppercut source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[3]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (
    source.clip !== 'Uppercut' ||
    source.primary_category !== 'punch' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,47]' ||
    events.length !== 1 ||
    event.type !== 'upward close-range uppercut' ||
    event.limb !== 'hand.R' ||
    JSON.stringify(event.window) !== '[21,24]' ||
    event.frame !== 23
  )
    throw new Error('Exact Uppercut event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'Uppercut',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateUppercutAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.0444444417953491)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 47,
    fps: 45,
    firstFrame: 21,
    lastFrame: 24,
    peakFrame: 23,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Exact byte pins bind these source facts; they do not authorize a surface choice.
  const sourceRoot = record(source.root_motion);
  return freeze({
    clipId: clipId('Uppercut'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/3',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/3',
      fullTimeAccessorPointer: '/accessors/6286',
      endpointAccessorPointer: '/accessors/6288',
      nativeTimesSha256: UPPERCUT_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'hand.R',
        side: 'R',
        sourceFrames: [21, 24] as const,
        peakFrame: 23,
        sourceEventPointer:
          '/clips/3/attack_and_timeline_events/attack_events/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: null,
        acceptance: null,
      },
    ],
    sourceRoot,
    sourceSupport: source.support_contacts,
    sourcePhases: source.phases,
    sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'Uppercut',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/3',
        supportPointer: '/clips/3/support_contacts/support',
      },
    }),
    rootTransformRequirement: {
      rootNode: 52,
      pelvisNode: 51,
      translationAccessor: 6287,
      quaternionAccessor: 6289,
      pelvisQuaternionAccessor: 6292,
      translationAccessorSha256:
        '678074325096ad36a60d646d8e7b9cc2199f71f0f292d809b6c997e4f14563b2',
      quaternionAccessorSha256:
        'bf2022dccf9d8fba203301d60bd02bc2f5a8ad2b80747468c8cd27115ff848a3',
      pelvisQuaternionAccessorSha256:
        'a291dabf69c34224e30373bb774cfb957ad289ed13c193d23cfb56c26dd585ce',
      translationAxes: ['x', 'y', 'z'] as const,
      rootRotationInterpolation: 'STEP' as const,
      rootQuaternionEndpoints: [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
      pelvisLocalRotation: 'authored-nonidentity' as const,
      parentNode: 54,
      parentTranslation: [0, -0.02199999988079071, 0],
      preserveAllAnimationChannels: true,
      sourceDescription: sourceRoot.root_motion,
      endReset: false,
      acceptance: null,
    },
    regionChoice: null,
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type UppercutDescriptor = ReturnType<typeof readUppercutSource>;

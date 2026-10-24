/** Metadata-only descriptor. No surface recipe or production admission. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const FLIPPING_SLASH_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256:
    'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath:
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256:
    'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export const FLIPPING_SLASH_NATIVE_TIMES_SHA256 =
  'f7ed2b2dad18130a46c367605595063afc2c63073b14e30a788fb3a6a6c68f85';
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
export function validateFlippingSlashAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 91 ||
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
  if (hash(bytes) !== FLIPPING_SLASH_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readFlippingSlashSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = FLIPPING_SLASH_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5584752 ||
    input.manifestBytes.byteLength !== 46217 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('FlippingSlash source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[5]);
  const events = list(record(source.attack_and_timeline_events).strikes);
  const event = record(events[0]);
  if (
    source.clip !== 'FlippingSlash' ||
    source.primary_category !== 'punch' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,91]' ||
    events.length !== 1 ||
    event.type !== 'single downward-forward unarmed arm strike' ||
    event.limb !== 'hand.R' ||
    JSON.stringify(event.active_frames) !== '[41,46]' ||
    event.impact_frame !== 44 ||
    event.target_added !== false
  )
    throw new Error('Exact FlippingSlash event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'FlippingSlash',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateFlippingSlashAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 2.0222222805023193)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 91,
    fps: 45,
    firstFrame: 41,
    lastFrame: 46,
    peakFrame: 44,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Exact byte pins bind these source facts; they do not authorize a surface choice.
  const sourceRoot = record(source.root_motion) as {
    root_motion: {
      rotation: string;
      end_reset: boolean;
      translation_blender: number[];
      direction: string;
      flight: string;
      runtime: string;
    };
  };
  return freeze({
    clipId: clipId('FlippingSlash'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/5',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/5',
      fullTimeAccessorPointer: '/accessors/514',
      endpointAccessorPointer: '/accessors/517',
      nativeTimesSha256: FLIPPING_SLASH_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'hand.R',
        side: 'R',
        sourceFrames: [41, 46] as const,
        peakFrame: 44,
        sourceEventPointer: '/clips/5/attack_and_timeline_events/strikes/0',
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
      clipId: 'FlippingSlash',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/5',
        supportPointer: '/clips/5/support_contacts/contacts',
      },
    }),
    rootTransformRequirement: {
      rootNode: 52,
      pelvisNode: 51,
      translationAccessor: 1963,
      quaternionAccessor: 1964,
      translationAccessorSha256:
        '64b28b3eb624a48267f83ef3eb11e5827176105de6c35e2df36e8f487f85e979',
      quaternionAccessorSha256:
        'e2a148f924d4b8bfc3a9428ea0c0732c29b6c8d7235d663dc3ca8bfd359135c5',
      translationAxes: ['x', 'y', 'z'] as const,
      preserveAllAnimationChannels: true,
      flipCarrier: 'root-parent-quaternion' as const,
      pelvisLocalRotation: 'identity' as const,
      sourceDescription: sourceRoot.root_motion.rotation,
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
export type FlippingSlashDescriptor = ReturnType<
  typeof readFlippingSlashSource
>;

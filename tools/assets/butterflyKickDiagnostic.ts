/** Raw metadata only. No pose evaluation, collision model or production admission. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';
export const BUTTERFLY_KICK_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const BUTTERFLY_KICK_NATIVE_TIMES_SHA256 =
  '486f31b8ffd8fe0f29b041f44d6d2881c07bc633e7e6984d7794103ac92f1e31';
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new Error('Source object required');
  return x as Record<string, unknown>;
}
function list(x: unknown): unknown[] {
  if (!Array.isArray(x)) throw new Error('Source array required');
  return x;
}
function integer(x: unknown): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0)
    throw new Error('Source index required');
  return x;
}
function freeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}
export function validateButterflyKickAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 88 ||
    times.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t !== Math.fround(t) ||
        t <= 0 ||
        (i > 0 && t <= (times[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4),
    view = new DataView(bytes.buffer);
  times.forEach((t, i) => {
    view.setFloat32(i * 4, t, true);
  });
  if (hash(bytes) !== BUTTERFLY_KICK_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
export function readButterflyKickSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = BUTTERFLY_KICK_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('ButterflyKick source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  const source = record(list(manifest.clips)[15]);
  const events = list(record(source.attack_and_timeline_events).strikes).map(
    record,
  );
  if (
    source.clip !== 'ButterflyKick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    JSON.stringify(source.source_frame_range) !== '[1,88]' ||
    events.length !== 2 ||
    events[0]?.limb !== 'foot.L' ||
    events[1]?.limb !== 'foot.R' ||
    JSON.stringify(events.map((e) => e.extension_window)) !==
      '[[35,39],[41,47]]' ||
    JSON.stringify(events.map((e) => e.peak_frame)) !== '[37,43]'
  )
    throw new Error('Exact ButterflyKick events required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'ButterflyKick',
  );
  if (!binary) throw new Error('Source animation required');
  validateButterflyKickAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.9555555582046509)
    throw new Error('Native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  // Full source hash and structural inspection precede this raw metadata extraction.
  const view = new DataView(
    input.sourceBytes.buffer,
    input.sourceBytes.byteOffset,
    input.sourceBytes.byteLength,
  );
  const n = view.getUint32(12, true);
  const raw = record(
    JSON.parse(
      new TextDecoder().decode(input.sourceBytes.subarray(20, 20 + n)),
    ),
  );
  const animation = record(list(raw.animations)[15]);
  const transformChannels = list(animation.channels)
    .map(record)
    .filter((c) =>
      [52, 51, 46, 45, 44, 43, 50, 49, 48, 47].includes(
        integer(record(c.target).node),
      ),
    )
    .map((c) => {
      const target = record(c.target),
        sampler = record(list(animation.samplers)[integer(c.sampler)]);
      const output = integer(sampler.output),
        accessor = record(list(raw.accessors)[output]);
      const bv = record(list(raw.bufferViews)[integer(accessor.bufferView)]);
      const width = target.path === 'rotation' ? 4 : 3;
      const start =
        28 +
        n +
        integer(bv.byteOffset ?? 0) +
        integer(accessor.byteOffset ?? 0);
      const values = Array.from({ length: integer(accessor.count) }, (_, i) =>
        Array.from({ length: width }, (_, k) =>
          view.getFloat32(
            start + i * integer(bv.byteStride ?? width * 4) + k * 4,
            true,
          ),
        ),
      );
      const bytes = new Uint8Array(values.length * width * 4),
        packed = new DataView(bytes.buffer);
      values.flat().forEach((x, i) => {
        packed.setFloat32(i * 4, x, true);
      });
      return {
        node: integer(target.node),
        path: String(target.path),
        input: integer(sampler.input),
        output,
        interpolation: String(sampler.interpolation),
        sha256: hash(bytes),
        values,
      };
    });
  return freeze({
    clipId: clipId('ButterflyKick'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/15',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/15',
      fullTimeAccessorPointer: '/accessors/353',
      endpointAccessorPointer: '/accessors/356',
      nativeTimesSha256: BUTTERFLY_KICK_NATIVE_TIMES_SHA256,
    },
    events: events.map((event, i) => {
      const frames = i === 0 ? ([35, 39] as const) : ([41, 47] as const),
        peak = i === 0 ? 37 : 43;
      return {
        impactIndex: i,
        boneName: i === 0 ? 'foot.L' : 'foot.R',
        side: i === 0 ? 'L' : 'R',
        node: i === 0 ? 44 : 48,
        skinJoint: i === 0 ? 47 : 51,
        sourceFrames: frames,
        peakFrame: peak,
        sourceEventPointer: `/clips/15/attack_and_timeline_events/strikes/${i}`,
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window: inclusiveAccessorFrameWindow({
          sourceStartFrame: 1,
          sourceEndFrame: 88,
          fps: 45,
          firstFrame: frames[0],
          lastFrame: frames[1],
          peakFrame: peak,
          accessorTimesSeconds: binary.sampleTimes,
          durationMs: actualDurationMs,
        }),
        intendedRegion: null,
        acceptance: null,
      };
    }),
    transformChannels,
    sourceRoot: source.root_motion,
    sourceSupport: source.support_contacts,
    sourcePhases: source.phases,
    sourceStartEndUse: source.start_end_use,
    supportVerification: {
      status: 'source-claim-unverified',
      validationDocument: 'contact_and_continuity_validation.json',
      validationDocumentAvailable: false,
      limitation:
        'Referenced document absent from inspected kick source folder; support, airborne and clearance claims have not been independently evaluated.',
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
      rootNode: 52,
      pelvisNode: 51,
      parentNode: 54,
      parentTranslation: [0, -0.02199999988079071, 0],
      translationAccessor: 354,
      quaternionAccessor: 355,
      pelvisTranslationAccessor: 358,
      pelvisQuaternionAccessor: 359,
      initialHoldMs: 22.22222276031971,
      preserveAllAnimationChannels: true,
      endReset: false,
      applyOrExtractExactlyOnce: true,
      yawProjectionIsAuthoredHeading: false,
      rotationPolicy:
        'Preserve all 88 full native quaternions including pitch and roll; no monotonic yaw or equivalent-endpoint replacement.',
      scaleAndPelvisPolicy:
        'Preserve native microscopic TRS differences and interpolation; do not replace with exact identity.',
      acceptance: null,
    },
    candidateModelStatus: 'not-selected',
    completionPath:
      'A developer-selected whole-foot model may later be proposed, analogous to FlyingKick/KickCombo. Generic foot annotations do not author that anatomy. Separate visual and quantitative gates are required before implementation; this metadata reader selects no surface or model.',
    regionChoice: null,
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}
export type ButterflyKickDescriptor = ReturnType<
  typeof readButterflyKickSource
>;

/** Source0 declaration only. This new collision abstraction is not gameplay acceptance. */
import { createHash } from 'node:crypto';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { inspectGlb } from '../../src/assets/source';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveFrameWindow } from './annotationPolicy';

export const KICK_COMBO_FOUR_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const KICK_COMBO_FOUR_NATIVE_TIMES_SHA256 =
  '1f4e830ec599551be7ac8e9cc58d113d388417ec5326b2921a88133865f7c031';
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Source object required');
  return value as Record<string, unknown>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function validateKickComboFourAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 136 ||
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
  times.forEach((time, i) => {
    view.setFloat32(i * 4, time, true);
  });
  if (hash(bytes) !== KICK_COMBO_FOUR_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}

export function readKickComboFourCollisionCandidate(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = KICK_COMBO_FOUR_SOURCE_PINS;
  if (
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('KickCombo4 source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    !Array.isArray(manifest.clips)
  )
    throw new Error('Exact already-retimed source required');
  const source = record(manifest.clips[4]);
  const sourceEvents = record(source.attack_and_timeline_events).attack_events;
  const expectedEvents = [
    {
      frame: 22,
      active_frames: [20, 23],
      limb: 'right foot',
      kind: 'front kick',
    },
    {
      frame: 43,
      active_frames: [41, 44],
      limb: 'right heel/sole',
      kind: 'side kick',
    },
    {
      frame: 68,
      active_frames: [66, 72],
      limb: 'right instep/shin',
      kind: 'roundhouse kick',
    },
    {
      frame: 106,
      active_frames: [101, 110],
      limb: 'right foot',
      kind: 'low sweep',
    },
  ];
  if (
    source.clip !== 'KickCombo4' ||
    source.primary_category !== 'kick' ||
    source.fps !== 45 ||
    source.loop !== false ||
    JSON.stringify(source.source_frame_range) !== '[1,136]' ||
    JSON.stringify(sourceEvents) !== JSON.stringify(expectedEvents)
  )
    throw new Error('Exact four authored KickCombo4 events required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'KickCombo4',
  );
  if (!binary) throw new Error('Exact binary clip required');
  validateKickComboFourAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 3.0222222805023193)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const shapeId = 'KickCombo4:right-foot:dominant-subtree:collision-v1';
  // This export's exact Float32 clock slightly exceeds the generic grid guard
  // at frame 127. Authenticate bytes first; never round or widen shared tolerance.
  const events = expectedEvents.map((sourceEvent, impactIndex) => {
    const firstFrame = sourceEvent.active_frames[0];
    const lastFrame = sourceEvent.active_frames[1];
    const peakFrame = sourceEvent.frame;
    if (
      firstFrame === undefined ||
      lastFrame === undefined ||
      ![firstFrame, lastFrame, peakFrame].every(Number.isSafeInteger) ||
      firstFrame < 1 ||
      lastFrame < firstFrame ||
      lastFrame >= binary.sampleTimes.length ||
      peakFrame < firstFrame ||
      peakFrame > lastFrame
    )
      throw new Error('Exact authored native index bounds required');
    const at = (frame: number) => {
      const seconds = binary.sampleTimes[frame - 1];
      if (seconds === undefined || !Number.isFinite(seconds))
        throw new Error('Missing authenticated native key');
      return seconds * 1000;
    };
    const startMs = at(firstFrame),
      endMs = at(lastFrame + 1),
      peakMs = at(peakFrame);
    if (
      !(
        startMs < endMs &&
        peakMs >= startMs &&
        peakMs < endMs &&
        endMs <= actualDurationMs
      )
    )
      throw new Error('Invalid authenticated native window');
    return {
      impactIndex,
      sourceEvent,
      sourceEventPointer: `/clips/4/attack_and_timeline_events/attack_events/${impactIndex}`,
      modelInterpretation:
        impactIndex === 1
          ? 'whole-foot-may-contact-other-foot-surfaces'
          : impactIndex === 2
            ? 'foot-side-interpretation-excludes-shin'
            : 'whole-source-authored-right-foot',
      window: {
        policy: 'inclusive-accessor-frame-cells-v1' as const,
        acceptance: 'provisional-policy' as const,
        startMs,
        endMs,
        peakMs,
        initialHoldEndMs: at(1),
        relativeClock: inclusiveFrameWindow({
          sourceStartFrame: 1,
          fps: 45,
          firstFrame,
          lastFrame,
          peakFrame,
          durationMs: actualDurationMs,
        }),
      },
      acceptance: null,
    };
  });
  const impacts = events.map((e) => ({
    impactIndex: e.impactIndex,
    startMs: durationMs(e.window.startMs),
    endMs: durationMs(e.window.endMs),
    damageShare: 0.25,
    shapeId,
  }));
  // Exactly mirror bakeMotion's fixed-key union, without invoking a source evaluator.
  const keys = new Set<number>([
    0,
    actualDurationMs,
    ...binary.sampleTimes.map((t) => t * 1000),
    ...impacts.flatMap((i) => [i.startMs, i.endMs]),
  ]);
  for (let i = 1; i < Math.ceil((actualDurationMs * 240) / 1000); i++)
    keys.add((i * 1000) / 240);
  const baseKeysMs = [...keys].sort((a, b) => a - b);
  const activeIntervals: [number, number][] = [];
  for (let i = 1; i < baseKeysMs.length; i++) {
    const a = baseKeysMs[i - 1],
      b = baseKeysMs[i];
    if (a === undefined || b === undefined)
      throw new Error('Missing schedule key');
    if (impacts.some((impact) => a >= impact.startMs && b <= impact.endMs))
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
    baseKeysMs.length !== 859 ||
    activeIntervals.length !== 159 ||
    probeKeysMs.length !== 477 ||
    sampleKeysMs.length !== 1336 ||
    sampleKeysMs.some(
      (t, i) =>
        !Number.isFinite(t) ||
        t < 0 ||
        t > actualDurationMs ||
        (i > 0 && t <= (sampleKeysMs[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact finite KickCombo4 schedule required');
  return freeze({
    clipId: clipId('KickCombo4'),
    category: 'kick' as const,
    durationMs: actualDurationMs,
    sourcePins: pins,
    sourceClipPointer: '/clips/4',
    sourceTimesSeconds: [...binary.sampleTimes],
    nativeTimesSha256: KICK_COMBO_FOUR_NATIVE_TIMES_SHA256,
    clockAdaptation: {
      kind: 'exact-hash-pinned-native-index-mapping' as const,
      timestampsModified: false,
      sharedToleranceModified: false,
      reason:
        'Known Float32-grid deviation at frame 127; authenticated native indexing preserves source timestamps and existing half-open frame cells. This is a local adaptation, not a source defect.',
    },
    events,
    impacts,
    damageShareOrigin:
      'provisional-developer-balancing-not-source-fact' as const,
    shapes: [
      { shapeId, bone: 'foot.R', surface: 'dominant-skin-subtree' as const },
    ],
    model: {
      origin: 'developer-collision-abstraction' as const,
      selection: 'whole-right-foot-joint-subtree' as const,
      primitive: 'posed-cluster-enclosing-sphere' as const,
      includesShin: false,
      narrowPatchUnion: false,
      expectedSelectionCountsByPrimitive: [615, 440, 386, 588, 255],
      expectedSelectedVertexCount: 2284,
      selectionProvenance:
        'raw-accessor dominant-weight inspection; evaluator must verify exact membership before sampling',
      limitation:
        'Dominant-weight subtree is a deterministic rendered cluster, not complete anatomical segmentation. Event 1 may contact other foot surfaces; event 2 chooses the foot-side interpretation and excludes shin. Candidate requires visual, intended-hit, near-miss and clash review.',
    },
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'KickCombo4',
      sourceSha256: pins.sourceSha256,
      mode: 'in-place-posture-xyz',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/4',
        supportPointer: '/clips/4/support_contacts/support_contacts/0',
      },
    }),
    rootTransformRequirement: {
      translationAccessor: 3242,
      quaternionAccessor: 3243,
      parentOffset: [0, -0.02199999988079071, 0],
      preserveAllAnimationChannels: true,
      extractedTransport: [0, 0, 0],
      nativeXYZAndYaw: 'retained-in-posed-geometry-not-flattened',
    },
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'spatial-movement' as const,
        verticalOwner: 'spatial-jump' as const,
      },
    ],
    schedule: {
      sampleRateHz: 240,
      baseKeysMs,
      activeIntervals,
      probeKeysMs,
      sampleKeysMs,
      startupUpdates: 1,
      maximumSourceUpdates: 1337,
      maximumMeasuredVertexEvaluations: 3051424,
      adaptiveCalls: 0,
      probeLimitation:
        'Finite probes only; residuals do not confer continuous or gameplay acceptance.',
    },
    sourceRoot: source.root_motion,
    sourceSupport: source.support_contacts,
    sourceFineAnatomyAcceptance: null,
    rootPolicyAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

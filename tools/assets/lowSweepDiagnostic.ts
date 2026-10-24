/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const LOW_SWEEP_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const LOW_SWEEP_NATIVE_TIMES_SHA256 =
  '4c4fe9c3689e51db7c769646293ae01ce647d455c010896595e63c7771159b84';
export interface LowSweepSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const lowSweepHash = (bytes: Uint8Array) =>
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
export function validateLowSweepAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 55 ||
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
  if (lowSweepHash(bytes) !== LOW_SWEEP_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor hash mismatch');
}
/** Reads pinned binary metadata only; no animation evaluator or transform application. */
function readPinnedAccessor(
  bytes: Uint8Array,
  index: number,
  width: number,
  count: number,
  expectedHash: string,
) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = data.getUint32(12, true);
  const document = record(
    JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))),
  );
  const accessor = record(list(document.accessors)[index]);
  if (
    accessor.componentType !== 5126 ||
    accessor.count !== count ||
    accessor.type !== (width === 4 ? 'VEC4' : 'VEC3')
  )
    throw new Error('Exact float accessor required');
  const viewIndex = accessor.bufferView;
  if (typeof viewIndex !== 'number' || !Number.isSafeInteger(viewIndex))
    throw new Error('Required accessor view');
  const bufferView = record(list(document.bufferViews)[viewIndex]);
  const offset =
    28 +
    jsonLength +
    Number(bufferView.byteOffset ?? 0) +
    Number(accessor.byteOffset ?? 0);
  if (
    bufferView.byteStride !== undefined ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset + width * count * 4 > bytes.length
  )
    throw new Error('Exact packed accessor bounds required');
  const raw = bytes.subarray(offset, offset + width * count * 4);
  if (lowSweepHash(raw) !== expectedHash)
    throw new Error('Native root accessor hash mismatch');
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: width }, (_, c) =>
      data.getFloat32(offset + (i * width + c) * 4, true),
    ),
  );
}
function readNativeRootRotation(bytes: Uint8Array) {
  const rawSha256 =
    '0fe408a03db3e104d43d4309bc0ced9ee2748684c73b0ee352ca1958ecf50ecf';
  const quaternions = readPinnedAccessor(bytes, 4205, 4, 55, rawSha256);
  return {
    accessorPointer: '/accessors/4205',
    rawSha256,
    quaternions,
    interpolation: 'LINEAR' as const,
    pureAxisReconstruction: false,
  };
}
export function readLowSweepSource(input: LowSweepSourceInput) {
  const pins = LOW_SWEEP_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    lowSweepHash(input.sourceBytes) !== pins.sourceSha256 ||
    lowSweepHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('LowSweep source hash mismatch');
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
    source.clip !== 'LowSweep' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,55]' ||
    events.length !== 1 ||
    event.type !== 'low right leg sweep' ||
    JSON.stringify(event.frames) !== '[20,33]' ||
    event.impact_frame !== 29
  )
    throw new Error('Exact LowSweep event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'LowSweep',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateLowSweepAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.2222222089767456)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 55,
    fps: 45,
    firstFrame: 20,
    lastFrame: 33,
    peakFrame: 29,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as { root_motion: string };
  const sourceSupport = record(source.support_contacts) as {
    support_contacts: { limb: string; frames: number[]; description: string }[];
  };
  const sourcePhases = record(source.phases) as {
    phase_frames: {
      startup: number;
      low_chamber: number;
      extension: number;
      impact: number;
      follow_through: number;
      recoil: number;
      reset: number;
    };
  };
  const nativeRootRotation = readNativeRootRotation(input.sourceBytes);
  const positions = readPinnedAccessor(
    input.sourceBytes,
    4204,
    3,
    55,
    '77a633a8e64ea4947cb999bbe1aa6aa6f9b359f3e775ab675e0348b8cbbc8aa9',
  );
  const first = positions[0],
    last = positions.at(-1);
  if (!first || !last)
    throw new Error('Required native root translation endpoints');
  const net = first.map((value, i) => {
    const endpoint = last[i];
    if (endpoint === undefined) throw new Error('Required root component');
    return endpoint - value;
  });
  const nativeRootTranslation = { accessorPointer: '/accessors/4204', net };
  return freeze({
    clipId: clipId('LowSweep'),
    durationMs: actualDurationMs,
    initialHoldMs: (binary.sampleTimes[0] ?? 0) * 1000,
    runtimePlaybackMultiplier: 1,
    sourceClipPointer: '/clips/3',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/3',
      fullTimeAccessorPointer: '/accessors/4203',
      endpointAccessorPointer: '/accessors/4206',
      nativeTimesSha256: LOW_SWEEP_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'shin.R',
        side: 'R',
        sourceFrames: [20, 33] as const,
        peakFrame: 29,
        sourceEventPointer:
          '/clips/3/attack_and_timeline_events/attack_events/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: 'anterior-shin-hypothesis' as const,
        acceptance: null,
      },
    ],
    sourceRoot,
    sourceSupport,
    sourcePhases,
    nativeRootRotation,
    nativeRootTranslation,
    sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'LowSweep',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/3',
        supportPointer: '/clips/3/support_contacts/support_contacts',
      },
    }),
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'authored-root' as const,
      },
    ],
    shinRegion: {
      region: 'anterior-shin-hypothesis' as const,
      sourceAuthoredSubregion: false,
      hypothesisBasis:
        'Provisional developer diagnostic lower-leg coverage after fourteen successful poses and four CPU views; not a consistently leading striking surface or gameplay acceptance. Source says generic right leg.',
      inspectionReceiptSha256:
        'd0f1770ae5a8df9f0c13678b3a66d609d25681c0aa2ce9ea5a666d6cac0901f3',
      inspectionLauncherSha256:
        'c61af44ea288fe9a304ce0c7db8f861dfcd97b5452be46d915d3e2dd96b7b2e6',
      priorFailedInspectionSha256:
        '4cf5bdefe224b31744fecf316c30a26cd5d2dc43b4fa18f32a58457f2f1f0d30',
      inspectionSourceUpdates: 28,
      inspectionFrames: [
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
      ],
      inspectionPngSha256: {
        worldSide:
          'ff6f820485c3cbe86c7f5f2d65a0fd9f1a901a230b05100a6521929dfff30527',
        worldTop:
          '1dc83ffd945dba01ffd577c1075157e4d16992d954e770f39aa779323df47a46',
        dorsal:
          'bbadd167701aae0e7c7fa993f8d60e6e24da00721212bb2098ff984d278e6b7c',
        side: '928462f28cb36d7e570f597b549770854fc6521a6cd7e8dd9a0141f2bf784b62',
      },
      inspectionLimits:
        'Finite native frames only; nonoccluding wires and skeleton context, not full-body visual QA or contact direction validation. Failed first14 attempts preserved separately; successful second14 only produced outputs.',
      normalMotionReversal: {
        frame27: 0.6474632989381525,
        peakFrame29: -0.48948340426569775,
        resolved: false,
      },
      helperPath: 'tools/assets/bakeGroundedSweepDiagnostics.ts',
      helperSha256:
        'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013',
      predicates: {
        shinWeightMin: 0.5,
        shinYMin: 0.08,
        shinYMax: 0.36,
        shinZMax: -0.035,
        shinNormalZMax: -0.25,
      },
      shinJoint: 50,
      footJoint: 51,
      toeJoint: 52,
      regionUnion: false,
      fittedProxyCopied: false,
      visualAcceptance: null,
      consistentlyLeadingSurfaceAcceptance: null,
    },
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

export type LowSweepDescriptor = ReturnType<typeof readLowSweepSource>;
/** Pure schedule derivation. These numbers confer no permission to pose source. */
export function planLowSweepTimetables(descriptor: LowSweepDescriptor) {
  validateLowSweepAccessorTimes(descriptor.sourceTimesSeconds);
  if (
    descriptor.clipId !== 'LowSweep' ||
    descriptor.durationMs !== 1222.2222089767456
  )
    throw new Error('Exact descriptor required');
  const native = descriptor.sourceTimesSeconds.map((time) => time * 1000);
  const endpoints = [0, ...native];
  const candidate = new Set(endpoints);
  for (let i = 1; (i * 1000) / 240 < descriptor.durationMs; i++)
    candidate.add((i * 1000) / 240);
  const candidateTimesMs = [...candidate].sort((a, b) => a - b);
  const parity = new Set(endpoints);
  for (let i = 1; i < endpoints.length; i++)
    parity.add(((endpoints[i - 1] ?? 0) + (endpoints[i] ?? 0)) / 2);
  const parityTimesMs = [...parity].sort((a, b) => a - b);
  const start = native[19],
    peak = native[28],
    end = native[33];
  if (start === undefined || peak === undefined || end === undefined)
    throw new Error('Required event times');
  const activeFitTimesMs = candidateTimesMs.filter(
    (time) => time >= start && time <= end,
  );
  const probes = new Set([start, peak, end]);
  for (let i = 0; i < candidateTimesMs.length; i++) {
    const a = candidateTimesMs[i],
      b = candidateTimesMs[i + 1];
    if (a === undefined) throw new Error('Required candidate time');
    if (a >= start && a <= end) probes.add(a);
    if (b !== undefined)
      for (const q of [0.25, 0.5, 0.75]) {
        const time = a + (b - a) * q;
        if (time >= start && time <= end) probes.add(time);
      }
  }
  const enclosureTimesMs = [...probes].sort((a, b) => a - b);
  if (
    candidateTimesMs.length !== 348 ||
    activeFitTimesMs.length !== 90 ||
    enclosureTimesMs.length !== 357 ||
    parityTimesMs.length !== 111
  )
    throw new Error('Frozen schedule mismatch');
  return freeze({
    candidateTimesMs,
    activeFitTimesMs,
    enclosureTimesMs,
    parityTimesMs,
    attemptedCandidateMixerCalls:
      2 +
      candidateTimesMs.length +
      activeFitTimesMs.length +
      enclosureTimesMs.length,
    executionAuthorized: false,
  });
}

/** Finite diagnostic coverage only. Generic right-leg source does not author this narrow region.
 * External parity c400422fafc45aa47225203483089606c227b2f5d2c948221dc3225c8ee64c02
 * is not a committed source CI test. Separate original costs: failed14 + successful14
 * inspection attempts,797 candidate calls,113 parity calls. Raw quaternion components
 * were not independently compared at parity times; full rendered geometry was compared.
 * The capsule has coincident endpoints (sphere-equivalent), not a refitted narrow proxy.
 * Negative sampled escape,122.602mm directional excess and peak normal-motion reversal
 * remain distinct, unqualified measurements. No continuum, anatomical or gameplay acceptance. */
export const LOW_SWEEP_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    '699279a24b657a700c132eeb8e23bf69bf84c89374a454757453adc1ea0ae54c',
  recipeSha256:
    '9b55232b4ed7f3a77e01dbf736a344b2e7abcf5a34007657b127cf64561955d0',
});
type LowSweepCandidate = Awaited<
  ReturnType<typeof import('./bakeLowSweepDiagnostic').bakeLowSweepDiagnostic>
>;
function finiteDiagnosticTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) finiteDiagnosticTree(child);
}
export function loadLowSweepDiagnostic(input: {
  readonly candidateBytes: Uint8Array;
  readonly recipeBytes: Uint8Array;
}) {
  if (
    lowSweepHash(input.candidateBytes) !==
      LOW_SWEEP_DIAGNOSTIC_PINS.candidateSha256 ||
    lowSweepHash(input.recipeBytes) !== LOW_SWEEP_DIAGNOSTIC_PINS.recipeSha256
  )
    throw new Error('Diagnostic fixture hash mismatch');
  const document = record(
    JSON.parse(new TextDecoder().decode(input.candidateBytes)),
  );
  const candidate = document as unknown as LowSweepCandidate;
  const recipe = record(
    JSON.parse(new TextDecoder().decode(input.recipeBytes)),
  );
  finiteDiagnosticTree(candidate);
  finiteDiagnosticTree(recipe);
  const entry = candidate.results[0];
  if (
    candidate.status !== 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' ||
    candidate.results.length !== 1 ||
    !entry ||
    entry.descriptor.clipId !== 'LowSweep' ||
    entry.asset.definition.clipId !== 'LowSweep' ||
    entry.asset.definition.impacts.length !== 1 ||
    entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 348 ||
    entry.rawRootCurve.length !== 348 ||
    entry.regions.length !== 1 ||
    entry.finiteMeasurement.length !== 1
  )
    throw new Error('Pinned diagnostic identity required');
  if (
    document.diagnosticEvidence !==
      'New LowSweep candidate from checkpoint6d403d20361a1832e0e1ac9d985b0704c1ea2680; provisional anterior-shin coverage only, unresolved peak normal-motion reversal and no runtime/anatomical acceptance.' ||
    recipe.diagnosticEvidence !==
      'New LowSweep candidate on Node24.22.1; provisional anterior-shin coverage after finite source inspection; peak normal-motion reversal unresolved, not consistently leading strike or authored anatomy/gameplay acceptance.'
  )
    throw new Error('Exact diagnostic provenance required');
  for (const value of [
    entry.acceptance,
    entry.gameplayAllowance,
    entry.continuousContainment,
    entry.regionVisualAcceptance,
    entry.descriptor.rootPolicyAcceptance,
    entry.descriptor.ownershipAcceptance,
    recipe.acceptance,
    recipe.gameplayAllowance,
    recipe.visualAcceptance,
    recipe.consistentlyLeadingSurfaceAcceptance,
  ])
    if (value !== null)
      throw new Error('Null diagnostic qualifications required');
  const region = entry.regions[0];
  if (
    !region ||
    region.event.intendedRegion !== 'anterior-shin-hypothesis' ||
    region.polygons.length !== 233 ||
    region.polygons.some(
      (p) =>
        p.region !== 'anterior-shin-hypothesis' ||
        p.jointIndex !== 50 ||
        p.sourceJointName !== 'shin.R',
    ) ||
    recipe.regionUnion !== false ||
    recipe.fittedProxyCopied !== false ||
    recipe.helperSha256 !==
      'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013'
  )
    throw new Error('Exact original shin-only provenance required');
  const provenance = record(recipe.hypothesisProvenance);
  if (
    provenance.sourceAuthoredSubregion !== false ||
    provenance.inspectionReceiptSha256 !==
      'd0f1770ae5a8df9f0c13678b3a66d609d25681c0aa2ce9ea5a666d6cac0901f3' ||
    JSON.stringify(provenance.normalMotionReversal) !==
      JSON.stringify({
        frame27: 0.6474632989381525,
        peakFrame29: -0.48948340426569775,
        resolved: false,
      })
  )
    throw new Error('Unresolved coverage hypothesis required');
  validateLowSweepAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const plan = planLowSweepTimetables(entry.descriptor);
  if (
    JSON.stringify(entry.rawRootRotationCurve.map((k) => k.atMs)) !==
      JSON.stringify(plan.candidateTimesMs) ||
    JSON.stringify(entry.asset.definition.rootCurve) !==
      JSON.stringify(entry.rawRootCurve)
  )
    throw new Error('Native clock and root trajectory required');
  for (let i = 0; i < entry.descriptor.sourceTimesSeconds.length; i++) {
    const nativeTime = entry.descriptor.sourceTimesSeconds[i];
    const native = entry.descriptor.nativeRootRotation.quaternions[i];
    if (nativeTime === undefined || !native)
      throw new Error('Native rotation sample required');
    const observed = entry.rawRootRotationCurve.find(
      (k) => k.atMs === nativeTime * 1000,
    );
    if (!observed) throw new Error('Native quaternion key required');
    for (const [index, axis] of (['x', 'y', 'z', 'w'] as const).entries()) {
      const expected = native[index];
      if (
        expected === undefined ||
        Math.abs(observed.quaternion[axis] - expected) > 1e-6
      )
        throw new Error('Native quaternion required');
    }
  }
  if (
    entry.asset.shapes[0]?.keys.some(
      (k) =>
        k.volume.kind !== 'capsule' ||
        JSON.stringify(k.volume.start) !== JSON.stringify(k.volume.end),
    )
  )
    throw new Error('Pinned sphere-equivalent capsule required');
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (
    rootPolicy.mode !== 'full-translation' ||
    rootPolicy.sourceSha256 !== LOW_SWEEP_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !==
      LOW_SWEEP_SOURCE_PINS.manifestSha256 ||
    JSON.stringify(entry.asset.ownership) !==
      JSON.stringify([
        {
          atMs: 0,
          horizontalOwner: 'authored-root',
          verticalOwner: 'authored-root',
        },
      ])
  )
    throw new Error('Full native root ownership required');
  if (
    recipe.supportMeasurementStatus !==
    'Authored left-foot support frames1–55 and native pelvis lowering/Y rotation retained. No floor/sole-clearance claim; generic right-leg sweep does not author a narrow anatomical strike surface.'
  )
    throw new Error('Exact support limits required');
  return freeze({
    ...entry,
    rootPolicy,
    supportMeasurementStatus: recipe.supportMeasurementStatus as string,
  });
}

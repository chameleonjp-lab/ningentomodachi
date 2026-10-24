/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const FLYING_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const FLYING_NATIVE_TIMES_SHA256 =
  'f7cf632f6e1e453d4b6c113b33e465624b70eae1c58a8792b55789d75c1f332a';
export interface FlyingSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const flyingHash = (bytes: Uint8Array) =>
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
export function validateFlyingAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 78 ||
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
  if (flyingHash(bytes) !== FLYING_NATIVE_TIMES_SHA256)
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
  if (flyingHash(raw) !== expectedHash)
    throw new Error('Native root accessor hash mismatch');
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: width }, (_, c) =>
      data.getFloat32(offset + (i * width + c) * 4, true),
    ),
  );
}
function readNativeRootRotation(bytes: Uint8Array) {
  const rawSha256 =
    'bf2022dccf9d8fba203301d60bd02bc2f5a8ad2b80747468c8cd27115ff848a3';
  const quaternions = readPinnedAccessor(bytes, 2125, 4, 2, rawSha256);
  if (JSON.stringify(quaternions) !== '[[0,0,0,1],[0,0,0,1]]')
    throw new Error('Exact native identity quaternion required');
  return {
    accessorPointer: '/accessors/2125',
    rawSha256,
    quaternions,
    interpolation: 'STEP' as const,
    unwrappedYawRad: 0,
    pureAxisReconstruction: false,
  };
}
export function readFlyingSource(input: FlyingSourceInput) {
  const pins = FLYING_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    flyingHash(input.sourceBytes) !== pins.sourceSha256 ||
    flyingHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Flying source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[14]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (
    source.clip !== 'FlyingKick' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,78]' ||
    events.length !== 1 ||
    event.type !== 'forward_airborne_extended_foot_kick' ||
    event.limb !== 'foot.R' ||
    JSON.stringify(event.active_frames) !== '[39,46]' ||
    event.peak_frame !== 42 ||
    event.hit_count !== 1 ||
    event.not_a_knee_strike !== true
  )
    throw new Error('Exact Flying event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'FlyingKick',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateFlyingAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.7333332300186157)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 78,
    fps: 45,
    firstFrame: 39,
    lastFrame: 46,
    peakFrame: 42,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as {
    root_motion: {
      mode: string;
      end_reset: boolean;
      retain_end_displacement: boolean;
      runtime_note: string;
    };
  };
  const sourceSupport = record(source.support_contacts) as {
    support_contacts: { limb: string; frames: number[]; kind: string }[];
  };
  const sourcePhases = record(source.phases) as {
    airborne: {
      frames: number[];
      no_ground_snap: boolean;
    };
  };
  const nativeRootRotation = readNativeRootRotation(input.sourceBytes);
  const positions = readPinnedAccessor(
    input.sourceBytes,
    2123,
    3,
    78,
    'a26186b88f6dbeeb7ced7c141b7df6e6645c5d47dcbe048787645368089219e9',
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
  const nativeRootTranslation = { accessorPointer: '/accessors/2123', net };
  return freeze({
    clipId: clipId('FlyingKick'),
    durationMs: actualDurationMs,
    initialHoldMs: (binary.sampleTimes[0] ?? 0) * 1000,
    runtimePlaybackMultiplier: 1,
    sourceClipPointer: '/clips/14',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/14',
      fullTimeAccessorPointer: '/accessors/2122',
      endpointAccessorPointer: '/accessors/2124',
      nativeTimesSha256: FLYING_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'foot.R',
        side: 'R',
        sourceFrames: [39, 46] as const,
        peakFrame: 42,
        sourceEventPointer:
          '/clips/14/attack_and_timeline_events/attack_events/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: 'sole-hypothesis' as const,
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
      clipId: 'FlyingKick',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/14',
        supportPointer: '/clips/14/support_contacts/support_contacts',
      },
    }),
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'authored-root' as const,
      },
    ],
    soleRegion: {
      region: 'sole-hypothesis' as const,
      sourceAuthoredSubregion: false,
      hypothesisBasis:
        'Developer diagnostic assumption after eight original poses and four CPU projection sheets; source names only foot.R. Not gameplay acceptance.',
      inspectionReceiptSha256:
        '8aa4b7f1f11eb2172ebf7c9f01b1a404b3df1466b344802f9202fb6ec6db724c',
      inspectionLauncherSha256:
        '7894d4ef299b4d97017228a3d3b9f9614d48619214c10a75b323c91bd94489a4',
      inspectionFrames: [39, 40, 41, 42, 43, 44, 45, 46],
      inspectionPngSha256: {
        worldSide:
          '51e7346884cfc6742bc61e6ef0c48b068c81a7d08cf6459c64a3c367cf2cbf85',
        footSide:
          'c78451fc7b8ac0037f2c71f489f238a1f758f07815ac0847b463ef711b14f266',
        plantar:
          '2fbdb6118f090da31c6eddf97c8564c7d38cbf79d12f0edaf6a3a35806d3264c',
        dorsal:
          '0e0daee2d5e3f36adff5d62a9b65245731833d32ed17f4a7fcf0a4072b478b96',
      },
      inspectionLimits:
        'Finite native frames only; opposite wire views are nonoccluding; body context partly clipped, not full-body visual QA.',
      helperPath: 'tools/assets/bakeGroundedKickDiagnostics.ts',
      helperSha256:
        '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
      predicates: {
        combinedFootToeWeightMin: 0.5,
        bindYMax: 0.035,
        normalYMax: -0.35,
      },
      footJoint: 51,
      toeJoint: 52,
      regionUnion: false,
      fittedProxyCopied: false,
      visualAcceptance: null,
    },
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

export type FlyingDescriptor = ReturnType<typeof readFlyingSource>;
/** Pure schedule derivation. These numbers confer no permission to pose source. */
export function planFlyingTimetables(descriptor: FlyingDescriptor) {
  validateFlyingAccessorTimes(descriptor.sourceTimesSeconds);
  if (
    descriptor.clipId !== 'FlyingKick' ||
    descriptor.durationMs !== 1733.3332300186157
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
  const start = native[38],
    peak = native[41],
    end = native[46];
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
    candidateTimesMs.length !== 493 ||
    activeFitTimesMs.length !== 51 ||
    enclosureTimesMs.length !== 201 ||
    parityTimesMs.length !== 157
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

/** Flying finite diagnostic only. Source foot.R does not specify sole: the sole-only
 * region is developer judgment backed by the pinned eight-pose inspection.
 * External identity-parent parity d717eaffa5f9f2cc685d774d1cfaf842d5f5edbc64653569c9bdb07cbdf28737
 * is not a committed source CI test, anatomy/containment/runtime qualification.
 * Separate observed source costs: eight inspection poses,747 candidate calls,159 parity calls.
 * Body context was partly clipped and opposite wire views nonoccluding, not full-body visual QA. */
export const FLYING_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    '5a43975832bdea68082e0d3c541c644857a40c007a7cded46dae3ccf1692979a',
  recipeSha256:
    '0f5a992b95fcc6866d0f690d26052cfd10155dc2d5b6147152ef575a27beef47',
});
type FlyingCandidate = Awaited<
  ReturnType<typeof import('./bakeFlyingDiagnostic').bakeFlyingDiagnostic>
>;
function finiteDiagnosticTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) finiteDiagnosticTree(child);
}
export function loadFlyingDiagnostic(input: {
  readonly candidateBytes: Uint8Array;
  readonly recipeBytes: Uint8Array;
}) {
  if (
    flyingHash(input.candidateBytes) !==
      FLYING_DIAGNOSTIC_PINS.candidateSha256 ||
    flyingHash(input.recipeBytes) !== FLYING_DIAGNOSTIC_PINS.recipeSha256
  )
    throw new Error('Diagnostic fixture hash mismatch');
  const document = record(
    JSON.parse(new TextDecoder().decode(input.candidateBytes)),
  );
  const candidate = document as unknown as FlyingCandidate;
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
    document.diagnosticEvidence !==
      'New Flying candidate from checkpoint99605095; sole-only diagnostic hypothesis, no runtime or anatomical acceptance.' ||
    recipe.diagnosticEvidence !==
      'New Flying candidate on Node24.22.1; developer sole hypothesis based on finite original source inspection, not authored sole or gameplay acceptance.' ||
    entry.descriptor.clipId !== 'FlyingKick' ||
    entry.asset.definition.clipId !== 'FlyingKick' ||
    entry.asset.definition.impacts.length !== 1 ||
    entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 493 ||
    entry.rawRootCurve.length !== 493 ||
    entry.regions.length !== 1 ||
    entry.finiteMeasurement.length !== 1 ||
    entry.acceptance !== null ||
    entry.gameplayAllowance !== null ||
    entry.continuousContainment !== null ||
    entry.regionVisualAcceptance !== null ||
    entry.descriptor.rootPolicyAcceptance !== null ||
    entry.descriptor.ownershipAcceptance !== null ||
    recipe.acceptance !== null ||
    recipe.gameplayAllowance !== null ||
    recipe.visualAcceptance !== null
  )
    throw new Error(
      'Pinned diagnostic-only identity and qualification required',
    );
  if (
    entry.regions[0]?.event.intendedRegion !== 'sole-hypothesis' ||
    entry.regions[0].polygons.some(
      (polygon) => polygon.region !== 'sole-hypothesis',
    ) ||
    recipe.regionUnion !== false ||
    recipe.fittedProxyCopied !== false ||
    recipe.helperSha256 !==
      '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940'
  )
    throw new Error('Exact original sole-only provenance required');
  if (
    entry.rawRootRotationCurve.length !== 493 ||
    entry.rawRootRotationCurve.some(
      (key) =>
        key.quaternion.x !== 0 ||
        key.quaternion.y !== 0 ||
        key.quaternion.z !== 0 ||
        key.quaternion.w !== 1 ||
        key.visualYawRad !== 0,
    ) ||
    entry.rawRootCurve.some((key) => key.visualYawRad !== 0)
  )
    throw new Error('Native identity STEP quaternion and zero yaw required');
  if (
    entry.descriptor.soleRegion.sourceAuthoredSubregion !== false ||
    recipe.sourceAuthoredSubregion !== false ||
    entry.descriptor.soleRegion.inspectionReceiptSha256 !==
      '8aa4b7f1f11eb2172ebf7c9f01b1a404b3df1466b344802f9202fb6ec6db724c'
  )
    throw new Error(
      'Developer-only sole hypothesis inspection provenance required',
    );
  validateFlyingAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (
    rootPolicy.mode !== 'full-translation' ||
    rootPolicy.sourceSha256 !== FLYING_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !==
      FLYING_SOURCE_PINS.manifestSha256 ||
    JSON.stringify(entry.asset.ownership) !==
      JSON.stringify([
        {
          atMs: 0,
          horizontalOwner: 'authored-root',
          verticalOwner: 'authored-root',
        },
      ]) ||
    JSON.stringify(entry.asset.definition.rootCurve) !==
      JSON.stringify(entry.rawRootCurve) ||
    recipe.supportMeasurementStatus !==
      'Authored approach, launch, airborne frames27–55 and staggered landings retained. Foot/toe minima not measured in this candidate-only run; no sole-clearance claim.'
  )
    throw new Error(
      'Exact full native XYZ ownership and support limits required',
    );
  return freeze({
    ...entry,
    rootPolicy,
    supportMeasurementStatus: recipe.supportMeasurementStatus as string,
  });
}

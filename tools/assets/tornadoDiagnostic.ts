/** Reconstruction dated 2026-10-23T21:17Z from published main e69c98aa.
 * New unverified implementation, not recovered historical Tornado bytes or test evidence. */
/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const TORNADO_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const TORNADO_NATIVE_TIMES_SHA256 =
  'ea9a792887ba40d1fd486a531d5b5592ae1793a97d8a901095ba7cdde24761d6';
export interface TornadoSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const tornadoHash = (bytes: Uint8Array) =>
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
export function validateTornadoAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 100 ||
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
  if (tornadoHash(bytes) !== TORNADO_NATIVE_TIMES_SHA256)
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
  if (tornadoHash(raw) !== expectedHash)
    throw new Error('Native root accessor hash mismatch');
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: width }, (_, c) =>
      data.getFloat32(offset + (i * width + c) * 4, true),
    ),
  );
}
function readNativeRootRotation(bytes: Uint8Array) {
  const rawSha256 =
    '1e9f1540fb5d9b772ce2c51d6dcd6d27214ec82c741a06617481f75e93071860';
  const quaternions = readPinnedAccessor(bytes, 6127, 4, 100, rawSha256);
  let previousYaw: number | undefined;
  let unwrappedYawRad = 0;
  for (const q of quaternions) {
    const [x, y, z, w] = q;
    if (
      x === undefined ||
      y === undefined ||
      z === undefined ||
      w === undefined
    )
      throw new Error('Required quaternion');
    if (Math.abs(2 * (y * z - x * w)) >= 0.9999999)
      throw new Error('Unreviewed YXZ singularity');
    const yaw = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
    if (previousYaw !== undefined) {
      let delta = yaw - previousYaw;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      unwrappedYawRad += delta;
    }
    previousYaw = yaw;
  }
  if (Math.abs(unwrappedYawRad - Math.PI * 2) > 1e-5)
    throw new Error('Signed positive native revolution required');
  return {
    accessorPointer: '/accessors/6127',
    rawSha256,
    quaternions,
    unwrappedYawRad,
    pureAxisReconstruction: false,
  };
}
export function readTornadoSource(input: TornadoSourceInput) {
  const pins = TORNADO_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    tornadoHash(input.sourceBytes) !== pins.sourceSha256 ||
    tornadoHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Tornado source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[13]);
  const events = list(record(source.attack_and_timeline_events).strikes);
  const event = record(events[0]);
  if (
    source.clip !== 'TornadoKick' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,100]' ||
    events.length !== 1 ||
    event.type !==
      'aerial outside-to-inside crescent / spinning hook instep whip' ||
    event.limb !== 'foot.R' ||
    JSON.stringify(event.extension_window) !== '[47,55]' ||
    event.impact_frame !== 51
  )
    throw new Error('Exact Tornado event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'TornadoKick',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateTornadoAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 2.222222089767456)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 100,
    fps: 45,
    firstFrame: 47,
    lastFrame: 55,
    peakFrame: 51,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as {
    root_motion: {
      facing: string;
      unwrapped_yaw_degrees: Record<string, number>;
    };
  };
  const sourceSupport = record(source.support_contacts) as {
    support_contacts: { limb: string; frames: number[]; kind: string }[];
  };
  const sourcePhases = record(source.phases) as {
    airborne: {
      planned_frames: number[];
      body_grounded_correction_used: boolean;
    };
  };
  const nativeRootRotation = readNativeRootRotation(input.sourceBytes);
  const positions = readPinnedAccessor(
    input.sourceBytes,
    6126,
    3,
    100,
    '29c3791cc268f2af37b3ed105d9f4a43a78c40f346dc51c04616d120cd0326c3',
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
  const nativeRootTranslation = { accessorPointer: '/accessors/6126', net };
  return freeze({
    clipId: clipId('TornadoKick'),
    durationMs: actualDurationMs,
    initialHoldMs: (binary.sampleTimes[0] ?? 0) * 1000,
    runtimePlaybackMultiplier: 1,
    sourceClipPointer: '/clips/13',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/13',
      fullTimeAccessorPointer: '/accessors/6125',
      endpointAccessorPointer: '/accessors/6128',
      nativeTimesSha256: TORNADO_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'foot.R',
        side: 'R',
        sourceFrames: [47, 55] as const,
        peakFrame: 51,
        sourceEventPointer: '/clips/13/attack_and_timeline_events/strikes/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: 'instep-hypothesis' as const,
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
      clipId: 'TornadoKick',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/13',
        supportPointer: '/clips/13/support_contacts/support_contacts',
      },
    }),
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'authored-root' as const,
      },
    ],
    instepRegion: {
      region: 'instep-hypothesis' as const,
      helperPath: 'tools/assets/bakeGroundedSweepDiagnostics.ts',
      helperSha256:
        'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013',
      predicates: {
        combinedFootToeWeightMin: 0.5,
        bindZMin: 0.025,
        bindZMax: 0.23,
        bindYMin: 0.045,
        normalYMin: 0.35,
      },
      shinJoint: 50,
      footJoint: 51,
      toeJoint: 52,
      inverseBindAccessor: 30,
      inverseBindAccessorSha256:
        '8ce7000c4c625d9d7275093d3d223635d80054b50a4c3fdb6a21054fdb65824a',
      shinFrame:
        'shin inverse bind matrix multiplied by source mesh bind matrix',
      shinNormalFrame:
        'normal matrix of shin frame, normalized original normals',
      fabricatedShinInputs: false,
      regionUnion: false,
      visualAcceptance: null,
    },
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

export type TornadoDescriptor = ReturnType<typeof readTornadoSource>;
/** Pure schedule derivation. These numbers confer no permission to pose source. */
export function planTornadoTimetables(descriptor: TornadoDescriptor) {
  validateTornadoAccessorTimes(descriptor.sourceTimesSeconds);
  if (
    descriptor.clipId !== 'TornadoKick' ||
    descriptor.durationMs !== 2222.222089767456
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
  const start = native[46],
    peak = native[50],
    end = native[55];
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
    candidateTimesMs.length !== 632 ||
    activeFitTimesMs.length !== 58 ||
    enclosureTimesMs.length !== 229 ||
    parityTimesMs.length !== 201
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

/** Fresh reconstruction diagnostic, not recovered historical artifacts.
 * Candidate generation reader c14fd3dc/baker a69de020 precedes two non-numeric lint corrections.
 * External parity fd1dba8b used corrected reader 230c69b4/baker a0bf2a43.
 * Committed checks below are metadata/fixtures/synthetic only, not source parity replay.
 * Identity-parent rendered geometry and scalar yaw were compared externally; raw candidate
 * quaternion components were not independently compared. Positive escape is unqualified. */
export const TORNADO_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    'a6b4fa74fc2d43b97ce11e66ea97ea6eb5b32952baec76e63aeed1fef6ffcf35',
  recipeSha256:
    'f52eb97aebb9b84553fba032a41addbb5726f2afc5bccc59edd567b35efe9426',
});
type TornadoCandidate = Awaited<
  ReturnType<typeof import('./bakeTornadoDiagnostic').bakeTornadoDiagnostic>
>;
function finiteDiagnosticTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) finiteDiagnosticTree(child);
}
export function loadTornadoDiagnostic(input: {
  readonly candidateBytes: Uint8Array;
  readonly recipeBytes: Uint8Array;
}) {
  if (
    tornadoHash(input.candidateBytes) !==
      TORNADO_DIAGNOSTIC_PINS.candidateSha256 ||
    tornadoHash(input.recipeBytes) !== TORNADO_DIAGNOSTIC_PINS.recipeSha256
  )
    throw new Error('Diagnostic fixture hash mismatch');
  const document = record(
    JSON.parse(new TextDecoder().decode(input.candidateBytes)),
  );
  const candidate = document as unknown as TornadoCandidate;
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
    document.reconstructionEvidence !==
      'Newly generated from reconstructed checkpoint0da2e25 on Node24.22.1; not a recovered historical artifact.' ||
    recipe.reconstructionEvidence !==
      'Fresh execution on Node24.22.1; historical output hashes are comparison references only.' ||
    entry.descriptor.clipId !== 'TornadoKick' ||
    entry.asset.definition.clipId !== 'TornadoKick' ||
    entry.asset.definition.impacts.length !== 1 ||
    entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 632 ||
    entry.rawRootCurve.length !== 632 ||
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
      'Reconstructed diagnostic-only identity and qualification required',
    );
  if (
    entry.regions[0]?.event.intendedRegion !== 'instep-hypothesis' ||
    entry.regions[0].polygons.some(
      (polygon) => polygon.region !== 'instep-hypothesis',
    ) ||
    recipe.regionUnion !== false ||
    recipe.fittedProxyCopied !== false ||
    recipe.helperSha256 !==
      'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013'
  )
    throw new Error('Exact original instep-only provenance required');
  if (
    entry.rawRootRotationCurve.length !== 632 ||
    !entry.rawRootRotationCurve.some(
      (key) => key.quaternion.x !== 0 && key.quaternion.z !== 0,
    ) ||
    Math.abs(
      (entry.rawRootRotationCurve.at(-1)?.visualYawRad ?? 0) - Math.PI * 2,
    ) > 1e-5
  )
    throw new Error(
      'Native mixed quaternion and signed continuous yaw required',
    );
  validateTornadoAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (
    rootPolicy.mode !== 'full-translation' ||
    rootPolicy.sourceSha256 !== TORNADO_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !==
      TORNADO_SOURCE_PINS.manifestSha256 ||
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
      'Authored pivots, push-off, airborne and staggered landings retained. Foot/toe minima not measured in this candidate-only run; no sole-clearance claim.'
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

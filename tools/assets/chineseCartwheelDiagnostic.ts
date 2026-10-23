/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const CHINESE_CARTWHEEL_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const CHINESE_CARTWHEEL_NATIVE_TIMES_SHA256 =
  '4b19b01d5be5d6185408e44b37acbe6cac4dbb5cb3776cbbe02c3658ef0612bb';
export interface ChineseCartwheelKickSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const chineseCartwheelHash = (bytes: Uint8Array) =>
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
export function validateChineseCartwheelKickAccessorTimes(
  times: readonly number[],
) {
  if (
    times.length !== 101 ||
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
  times.forEach((time, i) => view.setFloat32(i * 4, time, true));
  if (chineseCartwheelHash(bytes) !== CHINESE_CARTWHEEL_NATIVE_TIMES_SHA256)
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
  if (chineseCartwheelHash(raw) !== expectedHash)
    throw new Error('Native root accessor hash mismatch');
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: width }, (_, c) =>
      data.getFloat32(offset + (i * width + c) * 4, true),
    ),
  );
}
function readNativeRootRotation(bytes: Uint8Array) {
  const rawSha256 =
    '3f4dde4337ecd676ed9730e9dceff58640876bf7ec1ff0e4069a2301b3096495';
  const quaternions = readPinnedAccessor(bytes, 838, 4, 101, rawSha256);
  let previousRoll: number | undefined,
    unwrappedZRollRad = 0;
  const yaws: number[] = [];
  for (const q of quaternions) {
    const [x, y, z, w] = q;
    if (
      x === undefined ||
      y === undefined ||
      z === undefined ||
      w === undefined
    )
      throw new Error('Required quaternion');
    // Raw YXZ angles: this pinned channel has x=y=0 and no singularity.
    const yaw = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
    const roll = Math.atan2(2 * (x * y + z * w), 1 - 2 * (x * x + z * z));
    yaws.push(yaw);
    if (previousRoll !== undefined) {
      let delta = roll - previousRoll;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      unwrappedZRollRad += delta;
    }
    previousRoll = roll;
  }
  if (
    yaws.some((yaw) => yaw !== 0) ||
    Math.abs(unwrappedZRollRad + Math.PI * 2) > 1e-5
  )
    throw new Error('Signed native Z roll distinct from zero yaw required');
  return {
    accessorPointer: '/accessors/838',
    rawSha256,
    quaternions,
    unwrappedZRollRad,
    scalarYawRange: [Math.min(...yaws), Math.max(...yaws)],
    rollIsNotYaw: true,
  };
}
export function readChineseCartwheelKickSource(
  input: ChineseCartwheelKickSourceInput,
) {
  const pins = CHINESE_CARTWHEEL_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    chineseCartwheelHash(input.sourceBytes) !== pins.sourceSha256 ||
    chineseCartwheelHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('ChineseCartwheelKick source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[16]);
  const events = list(record(source.attack_and_timeline_events).strikes);
  const event = record(events[0]);
  if (
    source.clip !== 'ChineseCartwheelKick' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,101]' ||
    events.length !== 1 ||
    event.type !== 'inverted cartwheel extension; sole attack' ||
    event.limb !== 'foot.R' ||
    JSON.stringify(event.window) !== '[45,52]' ||
    event.frame !== 49
  )
    throw new Error('Exact ChineseCartwheelKick event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (clip) => clip.name === 'ChineseCartwheelKick',
  );
  if (!binary) throw new Error('Exact source animation required');
  validateChineseCartwheelKickAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 2.2444443702697754)
    throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({
    sourceStartFrame: 1,
    sourceEndFrame: 101,
    fps: 45,
    firstFrame: 45,
    lastFrame: 52,
    peakFrame: 49,
    accessorTimesSeconds: binary.sampleTimes,
    durationMs: actualDurationMs,
  });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as {
    root_travel: {
      axis: string;
      meters: number;
      end_reset: boolean;
      continuous_cartwheel_roll_degrees: number;
    };
  };
  const sourceSupport = record(source.support_contacts) as {
    contacts: { limb: string; frames: number[]; contact: string }[];
  };
  const sourcePhases = record(source.phases);
  const nativeRootRotation = readNativeRootRotation(input.sourceBytes);
  const positions = readPinnedAccessor(
    input.sourceBytes,
    837,
    3,
    101,
    '0ed5c5d1d156c3c34a819f3ff04e2408f8bc13314db2fe11abbfdde7d4cfb6be',
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
  const nativeRootTranslation = { accessorPointer: '/accessors/837', net };
  return freeze({
    clipId: clipId('ChineseCartwheelKick'),
    durationMs: actualDurationMs,
    sourceClipPointer: '/clips/16',
    sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: {
      animationPointer: '/animations/16',
      fullTimeAccessorPointer: '/accessors/836',
      endpointAccessorPointer: '/accessors/839',
      nativeTimesSha256: CHINESE_CARTWHEEL_NATIVE_TIMES_SHA256,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'foot.R',
        side: 'R',
        sourceFrames: [45, 52] as const,
        peakFrame: 49,
        sourceEventPointer: '/clips/16/attack_and_timeline_events/strikes/0',
        sourceEvent: event,
        windowOrigin: 'source-authored-inclusive-frame-range' as const,
        window,
        intendedRegion: 'sole-only-hypothesis' as const,
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
      clipId: 'ChineseCartwheelKick',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/16',
        supportPointer: '/clips/16/support_contacts/contacts',
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
      region: 'sole' as const,
      helperPath: 'tools/assets/bakeGroundedKickDiagnostics.ts',
      helperSha256:
        '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
      predicates: {
        combinedFootToeWeightMin: 0.5,
        bindYMax: 0.035,
        normalYMax: -0.35,
      },
      heelFallback: false,
      visualAcceptance: null,
    },
    rootPolicyAcceptance: null,
    ownershipAcceptance: null,
    acceptance: null,
    gameplayAllowance: null,
  });
}

export type ChineseCartwheelKickDescriptor = ReturnType<
  typeof readChineseCartwheelKickSource
>;
/** Pure schedule derivation. These numbers confer no permission to pose source. */
export function planChineseCartwheelKickTimetables(
  descriptor: ChineseCartwheelKickDescriptor,
) {
  validateChineseCartwheelKickAccessorTimes(descriptor.sourceTimesSeconds);
  if (
    descriptor.clipId !== 'ChineseCartwheelKick' ||
    descriptor.durationMs !== 2244.4443702697754
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
  const start = native[44],
    peak = native[48],
    end = native[52];
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
    candidateTimesMs.length !== 638 ||
    activeFitTimesMs.length !== 51 ||
    enclosureTimesMs.length !== 201 ||
    parityTimesMs.length !== 203
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

/** Pinned r1 finite diagnostic only. Native signed Z roll is separate from scalar yaw zero.
 * External parity is not a committed source test or production/containment admission. */
export const CHINESE_CARTWHEEL_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256: '5f207107e81e6588fdbd4f767c154340cb8c1f22da973b8a38d6be7b9c502c39',
  recipeSha256: '42e91847e8efe49827989c9a089588582f43b30165d6707c467c72c9a3db1226',
});
type ChineseCartwheelKickCandidate = Awaited<ReturnType<typeof import('./bakeChineseCartwheelDiagnostic').bakeChineseCartwheelKickDiagnostic>>;
function finiteTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
export function loadChineseCartwheelKickDiagnostic(input: { readonly candidateBytes: Uint8Array; readonly recipeBytes: Uint8Array }) {
  if (chineseCartwheelHash(input.candidateBytes) !== CHINESE_CARTWHEEL_DIAGNOSTIC_PINS.candidateSha256 ||
    chineseCartwheelHash(input.recipeBytes) !== CHINESE_CARTWHEEL_DIAGNOSTIC_PINS.recipeSha256) throw new Error('Diagnostic fixture hash mismatch');
  const candidate = JSON.parse(new TextDecoder().decode(input.candidateBytes)) as ChineseCartwheelKickCandidate;
  const recipe = record(JSON.parse(new TextDecoder().decode(input.recipeBytes)));
  finiteTree(candidate); finiteTree(recipe);
  const entry = candidate.results[0];
  if (candidate.status !== 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' || candidate.results.length !== 1 || !entry ||
    entry.descriptor.clipId !== 'ChineseCartwheelKick' || entry.asset.definition.impacts.length !== 1 || entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 638 || entry.rawRootCurve.length !== 638 || entry.regions.length !== 1 ||
    entry.finiteMeasurement.length !== 1 || entry.acceptance !== null || entry.gameplayAllowance !== null ||
    entry.continuousContainment !== null || entry.regionVisualAcceptance !== null ||
    entry.descriptor.rootPolicyAcceptance !== null || entry.descriptor.ownershipAcceptance !== null ||
    recipe.acceptance !== null || recipe.gameplayAllowance !== null || recipe.visualAcceptance !== null ||
    recipe.supportMeasurementStatus !== 'Authored left/right hand support and later foot landings preserved; no generic airborne or grounding claim. Signed foot/toe minima not measured by this candidate-only run.')
    throw new Error('Diagnostic-only fixture qualification required');
  if (entry.regions[0]?.event.intendedRegion !== 'sole-only-hypothesis' ||
    entry.regions[0].polygons.some((polygon) => polygon.region !== 'sole') ||
    recipe.heelFallback !== false || recipe.fittedProxyCopied !== false)
    throw new Error('Exact sole-only diagnostic provenance required');
  if (entry.rawRootRotationCurve.length !== 638 || entry.rawRootRotationCurve.some((key) => key.visualYawRad !== 0 || key.quaternion.x !== 0 || key.quaternion.y !== 0) ||
    entry.rawRootCurve.some((key) => key.visualYawRad !== 0) ||
    Math.abs((entry.rawRootRotationCurve.at(-1)?.zRollRad ?? 0) + Math.PI * 2) > 1e-5)
    throw new Error('Signed native Z roll must remain separate from zero yaw');
  validateChineseCartwheelKickAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (rootPolicy.mode !== 'full-translation' || rootPolicy.sourceSha256 !== CHINESE_CARTWHEEL_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !== CHINESE_CARTWHEEL_SOURCE_PINS.manifestSha256 ||
    JSON.stringify(entry.asset.ownership) !== JSON.stringify([{ atMs: 0, horizontalOwner: 'authored-root', verticalOwner: 'authored-root' }]) ||
    JSON.stringify(entry.asset.definition.rootCurve) !== JSON.stringify(entry.rawRootCurve))
    throw new Error('Exact full native XYZ diagnostic ownership required');
  return freeze({ ...entry, rootPolicy, supportMeasurementStatus: recipe.supportMeasurementStatus as string });
}

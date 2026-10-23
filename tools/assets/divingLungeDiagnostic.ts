/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const DIVING_LUNGE_SOURCE_PINS = Object.freeze({
  sourcePath: 'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256: 'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath: 'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256: 'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export const DIVING_LUNGE_NATIVE_TIMES_SHA256 = 'c379599d5bdf86b23b1fdfb1a06f1061322f4a1758951760c0f1637d6baf341b';
export interface DivingLungeSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const divingLungeHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source object required');
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
export function validateDivingLungeAccessorTimes(times: readonly number[]) {
  if (times.length !== 85 || times.some((time, i) => !Number.isFinite(time) || time !== Math.fround(time) || time <= 0 ||
    (i > 0 && time <= (times[i - 1] ?? Infinity)))) throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((time, i) => view.setFloat32(i * 4, time, true));
  if (divingLungeHash(bytes) !== DIVING_LUNGE_NATIVE_TIMES_SHA256) throw new Error('Native accessor hash mismatch');
}
export function readDivingLungeSource(input: DivingLungeSourceInput) {
  const pins = DIVING_LUNGE_SOURCE_PINS;
  if (input.sourceBytes.byteLength !== 5584752 || input.manifestBytes.byteLength !== 46217 ||
    divingLungeHash(input.sourceBytes) !== pins.sourceSha256 || divingLungeHash(input.manifestBytes) !== pins.manifestSha256)
    throw new Error('DivingLunge source hash mismatch');
  const manifest = record(JSON.parse(new TextDecoder().decode(input.manifestBytes)));
  if (manifest.runtime_playback_speed !== 1 || manifest.baked_speed_multiplier !== 1.5) throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[6]);
  const events = list(record(source.attack_and_timeline_events).attack_events);
  const event = record(events[0]);
  if (source.clip !== 'DivingLunge' || source.primary_category !== 'punch' || source.loop !== false || source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,85]' || events.length !== 1 || event.type !== 'low forward aerial straight fist' ||
    event.limb !== 'hand.R' || JSON.stringify(event.frames) !== '[30,36]' || event.peak_frame !== 33 || event.count !== 1)
    throw new Error('Exact DivingLunge event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find((clip) => clip.name === 'DivingLunge');
  if (!binary) throw new Error('Exact source animation required');
  validateDivingLungeAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.8888888359069824) throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({ sourceStartFrame: 1, sourceEndFrame: 85, fps: 45,
    firstFrame: 30, lastFrame: 36, peakFrame: 33, accessorTimesSeconds: binary.sampleTimes, durationMs: actualDurationMs });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as {
    pivot_requirement: string;
    root_motion: { end_reset: boolean; runtime: string; flight: string; slide: string; forward_meters: number };
  };
  const sourceSupport = record(source.support_contacts) as {
    support_phases: { frames: number[]; support: string[]; behavior?: string }[];
  };
  return freeze({ clipId: clipId('DivingLunge'), durationMs: actualDurationMs,
    sourceClipPointer: '/clips/6', sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: { animationPointer: '/animations/6', fullTimeAccessorPointer: '/accessors/1641', endpointAccessorPointer: '/accessors/1644',
      nativeTimesSha256: DIVING_LUNGE_NATIVE_TIMES_SHA256 },
    events: [{ impactIndex: 0, boneName: 'hand.R', side: 'R', sourceFrames: [30, 36] as const, peakFrame: 33,
      sourceEventPointer: '/clips/6/attack_and_timeline_events/attack_events/0', sourceEvent: event,
      windowOrigin: 'source-authored-inclusive-frame-range' as const, window,
      intendedRegion: 'distal-hand-proximal-finger-rim-hypothesis' as const, acceptance: null }],
    sourceRoot, sourceSupport, sourcePhases: source.phases, sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({ version: 1, clipId: 'DivingLunge', sourceSha256: pins.sourceSha256, mode: 'full-translation',
      provenance: { manifestSha256: pins.manifestSha256, clipPointer: '/clips/6', supportPointer: '/clips/6/support_contacts/support_phases' } }),
    ownership: [{ atMs: durationMs(0), horizontalOwner: 'authored-root' as const, verticalOwner: 'authored-root' as const }],
    rootPolicyAcceptance: null, ownershipAcceptance: null, acceptance: null, gameplayAllowance: null,
  });
}
export type DivingLungeDescriptor = ReturnType<typeof readDivingLungeSource>;
/** Exact proposed schedules only. Counts are not permission to evaluate source. */
export function planDivingLungeTimetables(descriptor: DivingLungeDescriptor) {
  validateDivingLungeAccessorTimes(descriptor.sourceTimesSeconds);
  if (descriptor.clipId !== 'DivingLunge' || descriptor.durationMs !== 1888.8888359069824) throw new Error('Exact descriptor required');
  const native = descriptor.sourceTimesSeconds.map((time) => time * 1000);
  const endpoints = [0, ...native];
  const candidate = new Set(endpoints);
  for (let i = 1; (i * 1000) / 240 < descriptor.durationMs; i++) candidate.add((i * 1000) / 240);
  const candidateTimesMs = [...candidate].sort((a, b) => a - b);
  const parity = new Set(endpoints);
  for (let i = 1; i < endpoints.length; i++) parity.add(((endpoints[i - 1] ?? 0) + (endpoints[i] ?? 0)) / 2);
  const parityTimesMs = [...parity].sort((a, b) => a - b);
  const activeFitTimesMs = candidateTimesMs.filter((time) => time >= (native[29] ?? Infinity) && time <= (native[36] ?? -Infinity));
  if (candidateTimesMs.length !== 538 || parityTimesMs.length !== 171 || activeFitTimesMs.length !== 45) throw new Error('Frozen timetable count mismatch');
  return freeze({ candidateTimesMs, activeFitTimesMs, parityTimesMs, executionAuthorized: false as const });
}

/** Exact externally measured candidate, never production registry admission. */
export const DIVING_LUNGE_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256: '54ea4f400d3614929f032a3a45fb54d8ab63080e0d09ce0ab2896ce615b12c69',
  recipeSha256: '00b5b44a46da3d7769c3d08d727de1c04862592f477782bc0cc42a8e6c0672aa',
});
type DivingLungeCandidate = Awaited<ReturnType<typeof import('./bakeDivingLungeDiagnostic').bakeDivingLungeDiagnostic>>;
function finiteTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
export function loadDivingLungeDiagnostic(input: { readonly candidateBytes: Uint8Array; readonly recipeBytes: Uint8Array }) {
  if (divingLungeHash(input.candidateBytes) !== DIVING_LUNGE_DIAGNOSTIC_PINS.candidateSha256 ||
    divingLungeHash(input.recipeBytes) !== DIVING_LUNGE_DIAGNOSTIC_PINS.recipeSha256) throw new Error('Diagnostic fixture hash mismatch');
  const candidate = JSON.parse(new TextDecoder().decode(input.candidateBytes)) as DivingLungeCandidate;
  const recipe = record(JSON.parse(new TextDecoder().decode(input.recipeBytes)));
  finiteTree(candidate); finiteTree(recipe);
  const entry = candidate.results[0];
  if (candidate.status !== 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' || candidate.results.length !== 1 || !entry ||
    entry.descriptor.clipId !== 'DivingLunge' || entry.asset.definition.impacts.length !== 1 || entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 538 || entry.rawRootCurve.length !== 538 || entry.regions.length !== 1 ||
    entry.finiteMeasurement.length !== 1 || entry.acceptance !== null || entry.gameplayAllowance !== null ||
    entry.continuousContainment !== null || entry.regionVisualAcceptance !== null ||
    entry.descriptor.rootPolicyAcceptance !== null || entry.descriptor.ownershipAcceptance !== null ||
    recipe.acceptance !== null || recipe.gameplayAllowance !== null || recipe.visualAcceptance !== null ||
    recipe.supportMeasurementStatus !== 'Authored planted/airborne/deliberate slide distinctions preserved; signed support clearance not measured by this candidate-only run.')
    throw new Error('Diagnostic-only fixture qualification required');
  validateDivingLungeAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (rootPolicy.mode !== 'full-translation' || rootPolicy.sourceSha256 !== DIVING_LUNGE_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !== DIVING_LUNGE_SOURCE_PINS.manifestSha256 ||
    JSON.stringify(entry.asset.ownership) !== JSON.stringify([{ atMs: 0, horizontalOwner: 'authored-root', verticalOwner: 'authored-root' }]) ||
    JSON.stringify(entry.asset.definition.rootCurve) !== JSON.stringify(entry.rawRootCurve))
    throw new Error('Exact full native XYZ diagnostic ownership required');
  return freeze({ ...entry, rootPolicy, supportMeasurementStatus: recipe.supportMeasurementStatus as string });
}

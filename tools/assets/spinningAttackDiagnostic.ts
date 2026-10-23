/** Offline source-zero metadata only. No posing, geometry fitting, or production registry. */
import { createHash } from 'node:crypto';
import { inspectGlb } from '../../src/assets/source';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { clipId, durationMs } from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const SPINNING_ATTACK_SOURCE_PINS = Object.freeze({
  sourcePath: 'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256: '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256: 'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export const SPINNING_ATTACK_NATIVE_TIMES_SHA256 = '486f31b8ffd8fe0f29b041f44d6d2881c07bc633e7e6984d7794103ac92f1e31';
export interface SpinningAttackSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
export const spinningAttackHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
export function validateSpinningAttackAccessorTimes(times: readonly number[]) {
  if (times.length !== 88 || times.some((time, i) => !Number.isFinite(time) || time !== Math.fround(time) || time <= 0 ||
    (i > 0 && time <= (times[i - 1] ?? Infinity)))) throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((time, i) => view.setFloat32(i * 4, time, true));
  if (spinningAttackHash(bytes) !== SPINNING_ATTACK_NATIVE_TIMES_SHA256) throw new Error('Native accessor hash mismatch');
}
export function readSpinningAttackSource(input: SpinningAttackSourceInput) {
  const pins = SPINNING_ATTACK_SOURCE_PINS;
  if (input.sourceBytes.byteLength !== 5685720 || input.manifestBytes.byteLength !== 75327 ||
    spinningAttackHash(input.sourceBytes) !== pins.sourceSha256 || spinningAttackHash(input.manifestBytes) !== pins.manifestSha256)
    throw new Error('SpinningAttack source hash mismatch');
  const manifest = record(JSON.parse(new TextDecoder().decode(input.manifestBytes)));
  if (manifest.runtime_playback_speed !== 1 || manifest.baked_speed_multiplier !== 1.5) throw new Error('Already retimed source required');
  const source = record(list(manifest.clips)[5]);
  const events = list(record(source.attack_and_timeline_events).strikes);
  const event = record(events[0]);
  if (source.clip !== 'SpinningAttack' || source.primary_category !== 'kick' || source.loop !== false || source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,88]' || events.length !== 1 || event.type !== 'heel-led aerial spinning side kick' ||
    event.limb !== 'foot.R' || JSON.stringify(event.extension_window) !== '[39,43]' || event.impact_frame !== 43)
    throw new Error('Exact SpinningAttack event identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find((clip) => clip.name === 'SpinningAttack');
  if (!binary) throw new Error('Exact source animation required');
  validateSpinningAttackAccessorTimes(binary.sampleTimes);
  if (binary.durationSeconds !== 1.9555555582046509) throw new Error('Exact native duration required');
  const actualDurationMs = durationMs(binary.durationSeconds * 1000);
  const window = inclusiveAccessorFrameWindow({ sourceStartFrame: 1, sourceEndFrame: 88, fps: 45,
    firstFrame: 39, lastFrame: 43, peakFrame: 43, accessorTimesSeconds: binary.sampleTimes, durationMs: actualDurationMs });
  // Source byte pins authorize these JSON shapes, not runtime ownership acceptance.
  const sourceRoot = record(source.root_motion) as {
    root_motion: { unwrapped_rotation_degrees: { start: number; windup: number; takeoff: number; first_landing: number; end: number }; runtime: string };
  };
  const sourceSupport = record(source.support_contacts);
  const sourcePhases = record(source.phases) as { airborne: { planned_frames: number[]; body_grounded_correction_used: boolean } };
  return freeze({ clipId: clipId('SpinningAttack'), durationMs: actualDurationMs,
    sourceClipPointer: '/clips/5', sourceTimesSeconds: [...binary.sampleTimes],
    timeProvenance: { animationPointer: '/animations/5', fullTimeAccessorPointer: '/accessors/353', endpointAccessorPointer: '/accessors/356',
      nativeTimesSha256: SPINNING_ATTACK_NATIVE_TIMES_SHA256 },
    events: [{ impactIndex: 0, boneName: 'foot.R', side: 'R', sourceFrames: [39, 43] as const, peakFrame: 43,
      sourceEventPointer: '/clips/5/attack_and_timeline_events/strikes/0', sourceEvent: event,
      windowOrigin: 'source-authored-inclusive-frame-range' as const, window,
      intendedRegion: 'heel-only-hypothesis' as const, acceptance: null }],
    sourceRoot, sourceSupport, sourcePhases, sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({ version: 1, clipId: 'SpinningAttack', sourceSha256: pins.sourceSha256, mode: 'full-translation',
      provenance: { manifestSha256: pins.manifestSha256, clipPointer: '/clips/5', supportPointer: '/clips/5/support_contacts/support_contacts' } }),
    ownership: [{ atMs: durationMs(0), horizontalOwner: 'authored-root' as const, verticalOwner: 'authored-root' as const }],
    heelRegion: { region: 'heel' as const, helperPath: 'tools/assets/bakeGroundedKickDiagnostics.ts',
      helperSha256: '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
      predicates: { footWeightMin: 0.5, bindZMax: -0.035, bindYMax: 0.12, normalZMax: -0.25 },
      soleFallback: false, visualAcceptance: null },
    rootPolicyAcceptance: null, ownershipAcceptance: null, acceptance: null, gameplayAllowance: null,
  });
}

export type SpinningAttackDescriptor = ReturnType<typeof readSpinningAttackSource>;
/** Pure schedule derivation. These numbers confer no permission to pose source. */
export function planSpinningAttackTimetables(descriptor: SpinningAttackDescriptor) {
  validateSpinningAttackAccessorTimes(descriptor.sourceTimesSeconds);
  if (descriptor.clipId !== 'SpinningAttack' || descriptor.durationMs !== 1955.5555582046509)
    throw new Error('Exact descriptor required');
  const native = descriptor.sourceTimesSeconds.map((time) => time * 1000);
  const endpoints = [0, ...native];
  const candidate = new Set(endpoints);
  for (let i = 1; i * 1000 / 240 < descriptor.durationMs; i++) candidate.add(i * 1000 / 240);
  const candidateTimesMs = [...candidate].sort((a, b) => a - b);
  const parity = new Set(endpoints);
  for (let i = 1; i < endpoints.length; i++) parity.add(((endpoints[i - 1] ?? 0) + (endpoints[i] ?? 0)) / 2);
  const parityTimesMs = [...parity].sort((a, b) => a - b);
  const start = native[38], peak = native[42], end = native[43];
  if (start === undefined || peak === undefined || end === undefined) throw new Error('Required event times');
  const activeFitTimesMs = candidateTimesMs.filter((time) => time >= start && time <= end);
  const probes = new Set([start, peak, end]);
  for (let i = 0; i < candidateTimesMs.length; i++) {
    const a = candidateTimesMs[i], b = candidateTimesMs[i + 1];
    if (a === undefined) throw new Error('Required candidate time');
    if (a >= start && a <= end) probes.add(a);
    if (b !== undefined) for (const q of [0.25, 0.5, 0.75]) {
      const time = a + (b - a) * q;
      if (time >= start && time <= end) probes.add(time);
    }
  }
  const enclosureTimesMs = [...probes].sort((a, b) => a - b);
  if (candidateTimesMs.length !== 557 || activeFitTimesMs.length !== 33 || enclosureTimesMs.length !== 129 || parityTimesMs.length !== 177)
    throw new Error('Frozen schedule mismatch');
  return freeze({ candidateTimesMs, activeFitTimesMs, enclosureTimesMs, parityTimesMs,
    attemptedCandidateMixerCalls: 2 + candidateTimesMs.length + activeFitTimesMs.length + enclosureTimesMs.length,
    executionAuthorized: false });
}

/** Corrected r2 candidate only. Rejected/superseded r1 remains external evidence, never a fixture.
 * External parity is not a committed source test or production/containment admission. */
export const SPINNING_ATTACK_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256: 'fe4f782ee3c00e088b911497ba70d861d1cfe6c0448a92208773aeb0a2082ef1',
  recipeSha256: '4b336704782127cc39412d152a96cab0a8eea44511f0262e9c393fc34016f1cd',
});
type SpinningAttackCandidate = Awaited<ReturnType<typeof import('./bakeSpinningAttackDiagnostic').bakeSpinningAttackDiagnostic>>;
function finiteTree(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite diagnostic field');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
export function loadSpinningAttackDiagnostic(input: { readonly candidateBytes: Uint8Array; readonly recipeBytes: Uint8Array }) {
  if (spinningAttackHash(input.candidateBytes) !== SPINNING_ATTACK_DIAGNOSTIC_PINS.candidateSha256 ||
    spinningAttackHash(input.recipeBytes) !== SPINNING_ATTACK_DIAGNOSTIC_PINS.recipeSha256) throw new Error('Diagnostic fixture hash mismatch');
  const candidate = JSON.parse(new TextDecoder().decode(input.candidateBytes)) as SpinningAttackCandidate;
  const recipe = record(JSON.parse(new TextDecoder().decode(input.recipeBytes)));
  finiteTree(candidate); finiteTree(recipe);
  const entry = candidate.results[0];
  if (candidate.status !== 'DIAGNOSTIC_SOURCE_CANDIDATE_NOT_ACCEPTED' || candidate.results.length !== 1 || !entry ||
    entry.descriptor.clipId !== 'SpinningAttack' || entry.asset.definition.impacts.length !== 1 || entry.asset.shapes.length !== 1 ||
    entry.asset.definition.rootCurve.length !== 557 || entry.rawRootCurve.length !== 557 || entry.regions.length !== 1 ||
    entry.finiteMeasurement.length !== 1 || entry.acceptance !== null || entry.gameplayAllowance !== null ||
    entry.continuousContainment !== null || entry.regionVisualAcceptance !== null ||
    entry.descriptor.rootPolicyAcceptance !== null || entry.descriptor.ownershipAcceptance !== null ||
    recipe.acceptance !== null || recipe.gameplayAllowance !== null || recipe.visualAcceptance !== null ||
    recipe.supportMeasurementStatus !== 'Authored planted/takeoff/airborne/landing distinctions preserved; signed foot/toe minima not measured by this candidate-only run.')
    throw new Error('Diagnostic-only fixture qualification required');
  if (entry.regions[0]?.event.intendedRegion !== 'heel-only-hypothesis' ||
    entry.regions[0].polygons.some((polygon) => polygon.region !== 'heel') ||
    recipe.soleFallback !== false || recipe.fittedProxyCopied !== false)
    throw new Error('Exact heel-only diagnostic provenance required');
  validateSpinningAttackAccessorTimes(entry.descriptor.sourceTimesSeconds);
  const rootPolicy = copyRootPolicy(entry.descriptor.rootPolicy);
  if (rootPolicy.mode !== 'full-translation' || rootPolicy.sourceSha256 !== SPINNING_ATTACK_SOURCE_PINS.sourceSha256 ||
    rootPolicy.provenance.manifestSha256 !== SPINNING_ATTACK_SOURCE_PINS.manifestSha256 ||
    JSON.stringify(entry.asset.ownership) !== JSON.stringify([{ atMs: 0, horizontalOwner: 'authored-root', verticalOwner: 'authored-root' }]) ||
    JSON.stringify(entry.asset.definition.rootCurve) !== JSON.stringify(entry.rawRootCurve))
    throw new Error('Exact full native XYZ diagnostic ownership required');
  return freeze({ ...entry, rootPolicy, supportMeasurementStatus: recipe.supportMeasurementStatus as string });
}

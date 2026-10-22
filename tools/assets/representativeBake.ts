import { createHash } from 'node:crypto';
import { clipId, durationMs } from '../../src/contracts';
import { refineActiveEnvelopes } from './adaptiveBake';
import { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { inspectGlb } from '../../src/assets/source';
import { PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES } from '../../src/assets/representativePolicies';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected source object');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected source array');
  return value;
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected source number');
  return value;
}
export const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** Offline diagnostic artifacts only. This does NOT publish a runtime catalog,
 * infer missing windows, choose game balance, or certify C's root ownership. */
export async function bakeRepresentative(input: {
  readonly category: 'punch' | 'kick';
  readonly bytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly expectedGlbSha256: string;
  readonly sourcePath: string;
  readonly manifestPath: string;
}) {
  if (sha256(input.bytes) !== input.expectedGlbSha256)
    throw new Error('Source hash mismatch');
  const source = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    source.runtime_playback_speed !== 1 ||
    source.baked_speed_multiplier !== 1.5
  )
    throw new Error('Expected already retimed runtime-speed-one source');
  const index = input.category === 'punch' ? 1 : 0;
  const name = input.category === 'punch' ? 'Cross' : 'FrontKick';
  const bone = input.category === 'punch' ? 'hand.R' : 'foot.R';
  const clipSource = record(list(source.clips)[index]);
  if (
    clipSource.clip !== name ||
    clipSource.primary_category !== input.category
  )
    throw new Error('Unexpected representative source clip');
  const events = list(
    record(clipSource.attack_and_timeline_events).attack_events,
  );
  if (events.length !== 1)
    throw new Error('Representative requires exactly one explicit strike');
  const event = record(events[0]);
  const field = input.category === 'punch' ? 'window' : 'active_frames';
  const frames = list(event[field]);
  if (frames.length !== 2) throw new Error('Explicit interval missing');
  const range = list(clipSource.source_frame_range);
  const sourceStartFrame = finite(range[0]);
  const fps = finite(clipSource.fps);
  const inspected = inspectGlb(input.bytes);
  const clip = inspected.clips.find((clip) => clip.name === name);
  if (!clip) throw new Error('Missing binary clip');
  const window = inclusiveAccessorFrameWindow({
    sourceEndFrame: finite(range[1]),
    accessorTimesSeconds: clip.sampleTimes,
    sourceStartFrame,
    fps,
    firstFrame: finite(frames[0]),
    lastFrame: finite(frames[1]),
    peakFrame: finite(event.frame),
    durationMs: clip.durationSeconds * 1000,
  });
  const rootPolicy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES.find(
    (policy) => policy.clipId === name,
  );
  if (
    !rootPolicy ||
    rootPolicy.sourceSha256 !== input.expectedGlbSha256 ||
    rootPolicy.provenance.manifestSha256 !== sha256(input.manifestBytes)
  )
    throw new Error('Unproven representative root policy provenance');
  const shapeId = `${name}:contact:0`;
  const shapes = [{ shapeId, bone, surface: 'dominant-skin-subtree' as const }];
  const evaluator = await createSourceEvaluator(
    input.bytes,
    name,
    shapes,
    rootPolicy,
  );
  try {
    const refined = await refineActiveEnvelopes(
      {
        clipId: clipId(name),
        category: input.category,
        durationMs: durationMs(clip.durationSeconds * 1000),
        sampleRateHz: 240,
        sourceTimesMs: [
          ...clip.sampleTimes.map((time) => time * 1000),
          window.peakMs,
        ],
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(window.startMs),
            endMs: durationMs(window.endMs),
            damageShare: 1,
            shapeId,
          },
        ],
        ownership: [
          {
            atMs: durationMs(0),
            horizontalOwner: 'authored-root',
            verticalOwner: 'spatial-jump',
          },
        ],
      },
      () => createSourceEvaluator(input.bytes, name, shapes, rootPolicy),
    );
    const asset = refined.asset;
    const verification = await createSourceEvaluator(
      input.bytes,
      name,
      shapes,
      rootPolicy,
    );
    let maximumMidpointEnvelopeResidualM = 0,
      maximumMidpointRootErrorM = 0;
    let maximumResidualAtMs = 0;
    try {
      const curve = asset.shapes[0];
      if (!curve) throw new Error('Missing baked surface');
      for (let i = 1; i < curve.keys.length; i++) {
        const a = curve.keys[i - 1],
          b = curve.keys[i];
        const ra = asset.definition.rootCurve[i - 1],
          rb = asset.definition.rootCurve[i];
        if (
          !a ||
          !b ||
          !ra ||
          !rb ||
          a.volume.kind !== 'sphere' ||
          b.volume.kind !== 'sphere'
        )
          throw new Error('Invalid baked keys');
        const atMs = (a.atMs + b.atMs) / 2;
        const actual = verification.sample(durationMs(atMs));
        const volume = actual.shapes[0]?.volume;
        if (volume?.kind !== 'sphere')
          throw new Error('Missing measured surface');
        const residual =
          Math.hypot(
            volume.center.x - (a.volume.center.x + b.volume.center.x) / 2,
            volume.center.y - (a.volume.center.y + b.volume.center.y) / 2,
            volume.center.z - (a.volume.center.z + b.volume.center.z) / 2,
          ) +
          volume.radiusM -
          (a.volume.radiusM + b.volume.radiusM) / 2;
        if (residual > maximumMidpointEnvelopeResidualM) {
          maximumMidpointEnvelopeResidualM = residual;
          maximumResidualAtMs = atMs;
        }
        maximumMidpointRootErrorM = Math.max(
          maximumMidpointRootErrorM,
          Math.hypot(
            actual.root.position.x - (ra.position.x + rb.position.x) / 2,
            actual.root.position.y - (ra.position.y + rb.position.y) / 2,
            actual.root.position.z - (ra.position.z + rb.position.z) / 2,
          ),
        );
      }
    } finally {
      verification.dispose();
    }
    const rawEvaluator = await createSourceEvaluator(
      input.bytes,
      name,
      [],
      rootPolicy,
    );
    let rawRootCurve;
    try {
      rawRootCurve = asset.definition.rootCurve.map((key) => ({
        atMs: key.atMs,
        ...rawEvaluator.sample(key.atMs).rawRoot,
      }));
    } finally {
      rawEvaluator.dispose();
    }
    return {
      rootPolicy,
      rawRootCurve,
      schemaVersion: 2,
      status: 'PROVISIONAL_DIAGNOSTIC_NOT_PRODUCTION_READY' as const,
      source: {
        path: input.sourcePath,
        sha256: input.expectedGlbSha256,
        manifestPath: input.manifestPath,
        manifestSha256: sha256(input.manifestBytes),
        clipPointer: `/clips/${index}`,
        eventPointer: `/clips/${index}/attack_and_timeline_events/attack_events/0`,
        windowPointer: `/clips/${index}/attack_and_timeline_events/attack_events/0/${field}`,
        phasesPointer: `/clips/${index}/phases`,
        phases: clipSource.phases,
        sourceEvent: event,
        sourceStartFrame,
        fps,
        runtimePlaybackRate: 1,
        binaryAccessorTimesSeconds: clip.sampleTimes,
        binaryDurationSeconds: clip.durationSeconds,
      },
      annotation: {
        window,
        intervalEvidence: 'explicit-source-interval',
        surfaceEvidence:
          'measured-dominant-skin-subtree; whole limb envelope, not accepted contact patch',
        ownershipEvidence:
          'explicit source-bound grounded-posture-y v1; retain posture in visual/contact geometry, extract XZ only; spatial-jump owns vertical transport',
        damageShareEvidence:
          'one explicit strike owns the clip share; no damage strength chosen',
      },
      surfaceSelections: evaluator.surfaceSelections,
      measurements: {
        adaptive: refined.diagnostics,
        sampleCount: asset.definition.rootCurve.length,
        sampledConservativeEffectiveRangeM: asset.definition.effectiveRangeM,
        rootBoundsM: Object.fromEntries(
          (['x', 'y', 'z'] as const).map((axis) => [
            axis,
            {
              min: Math.min(
                ...asset.definition.rootCurve.map((key) => key.position[axis]),
              ),
              max: Math.max(
                ...asset.definition.rootCurve.map((key) => key.position[axis]),
              ),
            },
          ]),
        ),
        maximumMidpointEnvelopeResidualM,
        maximumResidualAtMs,
        maximumMidpointRootErrorM,
        uncertainty:
          'Every keyed posed surface is enclosed. Midpoint envelope residual is a conservative diagnostic, not a proof of vertex escape or continuous containment. No radius padding has been silently added.',
      },
      candidate: asset,
    };
  } finally {
    evaluator.dispose();
  }
}

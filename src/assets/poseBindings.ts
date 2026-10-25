import {
  clipId,
  durationMs,
  type ClipId,
  type DurationMs,
  type PoseCatalogBindings,
  type PoseClipBinding,
} from '../contracts';
import { copyRootPolicy, type ClipRootPolicy } from './rootPolicy';

/** Internal source provenance supplied by captured source bytes or a pinned lossless manifest.
 * Producing an identifier is not source authorization; the pinned factory owns that gate. */
export interface PoseBindingSource {
  readonly clipId: ClipId;
  readonly durationMs: DurationMs;
  readonly sourceSha256: string;
  readonly sourceClipIndex: number;
  readonly rootPolicy?: ClipRootPolicy;
}
const modes = ['idle', 'walk', 'run', 'jump'] as const;
const names = ['Idle', 'Walk', 'Run', 'Jump'] as const;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const digest = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** Detached structural capture only. Trusted source equality is independently checked by the loader. */
export function capturePoseBindings(value: unknown): PoseCatalogBindings {
  if (
    !record(value) ||
    value.version !== 1 ||
    !text(value.bindingSetId) ||
    !Array.isArray(value.clips) ||
    !value.clips.length ||
    !record(value.locomotion)
  )
    throw new Error('Invalid pose bindings');
  const seen = new Set<string>();
  const clips = value.clips.map((entry: unknown): PoseClipBinding => {
    if (
      !record(entry) ||
      !text(entry.clipId) ||
      seen.has(entry.clipId) ||
      !text(entry.sourceBindingId) ||
      typeof entry.durationMs !== 'number' ||
      !Number.isFinite(entry.durationMs) ||
      entry.durationMs <= 0
    )
      throw new Error('Invalid pose clip binding');
    seen.add(entry.clipId);
    return Object.freeze({
      clipId: clipId(entry.clipId),
      durationMs: durationMs(entry.durationMs),
      sourceBindingId: entry.sourceBindingId,
    });
  });
  const locomotion = value.locomotion;
  for (const mode of modes)
    if (!text(locomotion[mode]) || !seen.has(locomotion[mode]))
      throw new Error('Missing pose locomotion binding');
  const crouch = locomotion.crouch;
  if ('crouch' in locomotion && (!text(crouch) || !seen.has(crouch)))
    throw new Error('Missing pose crouch locomotion binding');
  // Individual checks preserve the exact public Record type without an assertion.
  if (
    !text(locomotion.idle) ||
    !text(locomotion.walk) ||
    !text(locomotion.run) ||
    !text(locomotion.jump)
  )
    throw new Error('Invalid locomotion map');
  return Object.freeze({
    version: 1,
    bindingSetId: value.bindingSetId,
    clips: Object.freeze(clips),
    locomotion: Object.freeze({
      idle: clipId(locomotion.idle),
      walk: clipId(locomotion.walk),
      run: clipId(locomotion.run),
      jump: clipId(locomotion.jump),
      ...(text(crouch) ? { crouch: clipId(crouch) } : {}),
    }),
  });
}

/** Optional availability is not selection. Retain every source binding while
 * deriving the set identity for a caller that did not select crouch. */
export async function omitCrouchLocomotion(
  input: PoseCatalogBindings,
): Promise<PoseCatalogBindings> {
  const captured = capturePoseBindings(input);
  const { idle, walk, run, jump } = captured.locomotion;
  const locomotion = { idle, walk, run, jump };
  const bindingSetId = `pose-set-v1:${await digest({
    clips: captured.clips,
    locomotion,
  })}`;
  return capturePoseBindings({ ...captured, bindingSetId, locomotion });
}

export async function buildPoseBindings(
  sources: readonly PoseBindingSource[],
  checkpoint?: () => Promise<void>,
): Promise<PoseCatalogBindings> {
  const seen = new Set<string>();
  // Capture the complete input before any asynchronous hash/checkpoint.
  const captured = sources
    .map((source) => {
      if (
        !text(source.clipId) ||
        seen.has(source.clipId) ||
        !/^[a-f0-9]{64}$/.test(source.sourceSha256) ||
        !Number.isSafeInteger(source.sourceClipIndex) ||
        source.sourceClipIndex < 0 ||
        !Number.isFinite(source.durationMs) ||
        source.durationMs <= 0
      )
        throw new Error('Invalid source pose provenance');
      seen.add(source.clipId);
      const policy =
        source.rootPolicy === undefined
          ? undefined
          : copyRootPolicy(source.rootPolicy);
      if (
        policy &&
        (policy.sourceSha256 !== source.sourceSha256 ||
          policy.clipId !== source.clipId)
      )
        throw new Error('Pose root policy source mismatch');
      return {
        clipId: source.clipId,
        durationMs: source.durationMs,
        sourceSha256: source.sourceSha256,
        sourceClipIndex: source.sourceClipIndex,
        rootPolicy: policy ?? null,
      };
    })
    .sort((a, b) => (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0));
  if (names.some((name) => !seen.has(name)))
    throw new Error('Missing source locomotion clips');
  const clips: PoseClipBinding[] = [];
  for (const source of captured) {
    const id = await digest({
      version: 1,
      source,
      sampling: 'three-0.186.1-absolute-source-trs-first-key-hold-v1',
      extraction:
        source.rootPolicy === null
          ? 'legacy-full-translation-first-animated-root-v1'
          : 'explicit-policy-first-animated-root-v1',
    });
    clips.push(
      Object.freeze({
        clipId: source.clipId,
        durationMs: source.durationMs,
        sourceBindingId: `pose-v1:${id}`,
      }),
    );
    await checkpoint?.();
  }
  const locomotion = {
    idle: clipId('Idle'),
    walk: clipId('Walk'),
    run: clipId('Run'),
    jump: clipId('Jump'),
    ...(seen.has('CrouchMove') ? { crouch: clipId('CrouchMove') } : {}),
  };
  const bindingSetId = `pose-set-v1:${await digest({ clips, locomotion })}`;
  return capturePoseBindings({ version: 1, bindingSetId, clips, locomotion });
}

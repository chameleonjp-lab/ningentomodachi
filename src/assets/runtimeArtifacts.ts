import type { ActorColor } from '../contracts';
import {
  importDeathClipArtifact,
  verifyDeathClipTargets,
} from './deathClipArtifact';
import { type ClipRootPolicy, copyRootPolicy } from './rootPolicy';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from './runtimeArtifactManifest';
import { artifactRecord, importSkinBoundsArtifact } from './skinBoundsArtifact';
import { SOURCE_PALETTES } from './sourcePalettes';
import {
  prepareThreeAssetPack,
  type ThreeAssetPack,
  type VerifiedPalette,
} from './threeAssetPack';

export interface PinnedAssetPackInput {
  readonly sources: readonly Uint8Array[];
  readonly artifactBytes: Uint8Array;
  readonly rootPolicies?: readonly ClipRootPolicy[];
  readonly signal: AbortSignal;
  /** A may budget/schedule further work. B also yields a real task at each boundary,
   * so Promise.resolve callbacks cannot silently starve rendering. */
  readonly checkpoint?: (stage: string) => Promise<void>;
}
const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
/** Required, built-in-hash-pinned path. No caller-selected digest, hull certification,
 * death authoring, source substitution or legacy fallback can authorize this pack. */
export async function createPinnedThreeAssetPack(
  input: PinnedAssetPackInput,
): Promise<ThreeAssetPack> {
  const signal = input.signal,
    scheduledCheckpoint = input.checkpoint;
  const checkAbort = () => {
    if (signal.aborted)
      throw new DOMException('Asset preparation aborted', 'AbortError');
  };
  checkAbort();
  const manifest = ANDROID_RUNTIME_ARTIFACT_V1;
  if (
    input.sources.length !== manifest.sources.length ||
    input.sources.some(
      (source, index) => source.byteLength !== manifest.sources[index]?.bytes,
    )
  )
    throw new Error('Pinned source set mismatch');
  if (input.artifactBytes.byteLength !== manifest.bytes)
    throw new Error('Pinned artifact length mismatch');
  // Snapshot EVERY mutable input before the first await. No later caller edit can
  // swap bytes, policies or palette values after successful verification.
  const sources = input.sources.map((bytes) => new Uint8Array(bytes)),
    artifactBytes = new Uint8Array(input.artifactBytes);
  const policies = (input.rootPolicies ?? []).map(copyRootPolicy);
  const palettes: Partial<Record<ActorColor, VerifiedPalette>> = {};
  for (const color of ['black', 'blue', 'green', 'yellow'] as const) {
    const palette = SOURCE_PALETTES[color];
    palettes[color] = {
      ...palette,
      armorRgb: [...palette.armorRgb],
      emissiveRgb: [...palette.emissiveRgb],
      inlayBaseRgb: [...palette.inlayBaseRgb],
    };
  }
  const checkpoint = async (stage: string) => {
    checkAbort();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkAbort();
    await scheduledCheckpoint?.(stage);
    checkAbort();
  };
  await checkpoint('hash:before');
  const artifactHash = await sha256(artifactBytes);
  checkAbort();
  if (artifactHash !== manifest.sha256)
    throw new Error('Pinned artifact hash mismatch');
  await checkpoint('hash:artifact');
  for (let index = 0; index < sources.length; index++) {
    const bytes = sources[index];
    if (!bytes) throw new Error('Missing pinned source');
    const hash = await sha256(bytes);
    checkAbort();
    if (hash !== manifest.sources[index]?.sha256)
      throw new Error('Pinned source hash mismatch');
    await checkpoint(`hash:source:${index}`);
  }
  // Parsing/import starts only after all trusted pins have passed.
  const decoded: unknown = JSON.parse(new TextDecoder().decode(artifactBytes));
  const payload = artifactRecord(decoded);
  if (
    payload.schemaVersion !== manifest.schemaVersion ||
    !Array.isArray(payload.sourceHashes) ||
    payload.sourceHashes.length !== manifest.sources.length ||
    payload.sourceHashes.some(
      (hash, index) => hash !== manifest.sources[index]?.sha256,
    )
  )
    throw new Error('Artifact source/version mismatch');
  await checkpoint('artifact:json');
  const deaths = await importDeathClipArtifact(payload.deaths, () =>
    checkpoint('artifact:death-tracks'),
  );
  let pack: ThreeAssetPack | undefined;
  try {
    pack = await prepareThreeAssetPack(sources, palettes, deaths, policies, {
      poseOrigin: (_name, sourceIndex, sourceClipIndex) => {
        const original = manifest.sources[sourceIndex];
        if (!original) throw new Error('Missing original pose source');
        return { sourceSha256: original.sha256, sourceClipIndex };
      },
      checkpoint,
      support: async (template) => {
        verifyDeathClipTargets(template, deaths);
        return importSkinBoundsArtifact(template, payload.support, () =>
          checkpoint('artifact:support'),
        );
      },
    });
    await checkpoint('pack:ready');
    return pack;
  } catch (error) {
    try {
      pack?.dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Asset preparation and cleanup failed',
      );
    }
    throw error;
  }
}

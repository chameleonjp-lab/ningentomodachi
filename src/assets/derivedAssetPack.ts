import { inspectGlbYielding } from './source';
import { parseGlbYielding } from './yieldingGltf';
import type { ActorColor } from '../contracts';
import { ANDROID_DERIVED_PACK_V1 } from './derivedPackManifest';
import type { PinnedAssetPackInput } from './runtimeArtifacts';
import {
  importDeathClipArtifact,
  verifyDeathClipTargets,
} from './deathClipArtifact';
import { copyRootPolicy } from './rootPolicy';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from './runtimeArtifactManifest';
import { artifactRecord, importSkinBoundsArtifact } from './skinBoundsArtifact';
import { SOURCE_PALETTES } from './sourcePalettes';
import {
  prepareThreeAssetPack,
  type ThreeAssetPack,
  type VerifiedPalette,
} from './threeAssetPack';

export interface PinnedDerivedAssetPackInput
  extends Omit<PinnedAssetPackInput, 'sources'> {
  readonly derivedBytes: Uint8Array;
}
const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
/** Required, built-in-hash-pinned path. No caller-selected digest, hull certification,
 * death authoring, source substitution or legacy fallback can authorize this pack. */
export async function createPinnedDerivedThreeAssetPack(
  input: PinnedDerivedAssetPackInput,
): Promise<ThreeAssetPack> {
  const signal = input.signal,
    scheduledCheckpoint = input.checkpoint;
  const checkAbort = () => {
    if (signal.aborted)
      throw new DOMException('Asset preparation aborted', 'AbortError');
  };
  checkAbort();
  const manifest = ANDROID_DERIVED_PACK_V1;
  const runtime = ANDROID_RUNTIME_ARTIFACT_V1;
  if (
    manifest.runtimeArtifactSha256 !== runtime.sha256 ||
    manifest.runtimeArtifactBytes !== runtime.bytes ||
    manifest.sources.length !== runtime.sources.length ||
    manifest.sources.some(
      (source, index) =>
        source.sha256 !== runtime.sources[index]?.sha256 ||
        source.bytes !== runtime.sources[index]?.bytes ||
        source.path !== runtime.sources[index]?.path,
    )
  )
    throw new Error('Derived/runtime provenance mismatch');
  if (input.derivedBytes.byteLength !== manifest.bytes)
    throw new Error('Pinned derived length mismatch');
  if (input.artifactBytes.byteLength !== runtime.bytes)
    throw new Error('Pinned artifact length mismatch');
  // Snapshot EVERY mutable input before the first await. No later caller edit can
  // swap bytes, policies or palette values after successful verification.
  const derivedBytes = new Uint8Array(input.derivedBytes),
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
  if (artifactHash !== runtime.sha256)
    throw new Error('Pinned artifact hash mismatch');
  await checkpoint('hash:artifact');
  const derivedHash = await sha256(derivedBytes);
  checkAbort();
  if (derivedHash !== manifest.sha256)
    throw new Error('Pinned derived hash mismatch');
  await checkpoint('hash:derived');
  // Parsing/import starts only after all trusted pins have passed.
  const decoded: unknown = JSON.parse(new TextDecoder().decode(artifactBytes));
  const payload = artifactRecord(decoded);
  if (
    payload.schemaVersion !== runtime.schemaVersion ||
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
    pack = await prepareThreeAssetPack(
      [derivedBytes],
      palettes,
      deaths,
      policies,
      {
        checkpoint,
        inspect: (bytes, index) =>
          inspectGlbYielding(bytes, (chunk) =>
            checkpoint(`inspect:${index}:chunk:${chunk}`),
          ),
        parse: (bytes, index) =>
          parseGlbYielding(bytes, (stage) =>
            checkpoint(`parse:${index}:${stage}`),
          ),
        poseOrigin: (name) => {
          const origin = manifest.clips.find((clip) => clip.name === name);
          if (
            !origin ||
            manifest.sources[origin.sourceIndex]?.sha256 !== origin.sourceSha256
          )
            throw new Error('Missing original pose provenance');
          return origin;
        },
        verifyPolicy: async (policy) => {
          // Only the built-in reviewed certificate may bind the original source.
          // Neither a caller-selected hash nor the derived GLB hash replaces it.
          const origin = manifest.clips.find(
            (clip) => clip.name === policy.clipId,
          );
          if (
            !origin ||
            origin.sourceSha256 !== policy.sourceSha256 ||
            manifest.sources[origin.sourceIndex]?.sha256 !== origin.sourceSha256
          )
            throw new Error('Root policy original source mismatch');
        },
        support: async (template) => {
          verifyDeathClipTargets(template, deaths);
          return importSkinBoundsArtifact(template, payload.support, () =>
            checkpoint('artifact:support'),
          );
        },
      },
    );
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

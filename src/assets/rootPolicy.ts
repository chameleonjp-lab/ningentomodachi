import { type ClipId, clipId, type Vector3 } from '../contracts';
import type { MotionAsset } from './motionCatalog';

/** Explicit source-bound extraction recipe. Absence is legacy full extraction, not production approval. */
export interface ClipRootPolicy {
  readonly version: 1;
  readonly clipId: ClipId;
  readonly sourceSha256: string;
  readonly mode:
    | 'full-translation'
    | 'grounded-posture-y'
    | 'in-place-posture-xyz';
  readonly provenance: {
    readonly manifestSha256: string;
    readonly clipPointer: string;
    readonly supportPointer: string;
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function copyRootPolicy(value: unknown): ClipRootPolicy {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.clipId !== 'string' ||
    !value.clipId.length ||
    !hash(value.sourceSha256) ||
    (value.mode !== 'full-translation' &&
      value.mode !== 'grounded-posture-y' &&
      value.mode !== 'in-place-posture-xyz') ||
    !record(value.provenance) ||
    !hash(value.provenance.manifestSha256) ||
    typeof value.provenance.clipPointer !== 'string' ||
    !/^\/clips\/\d+$/.test(value.provenance.clipPointer) ||
    typeof value.provenance.supportPointer !== 'string' ||
    !value.provenance.supportPointer.startsWith(
      `${value.provenance.clipPointer}/support_contacts`,
    )
  )
    throw new Error('Invalid root extraction policy');
  return Object.freeze({
    version: 1,
    clipId: clipId(value.clipId),
    sourceSha256: value.sourceSha256,
    mode: value.mode,
    provenance: Object.freeze({
      manifestSha256: value.provenance.manifestSha256,
      clipPointer: value.provenance.clipPointer,
      supportPointer: value.provenance.supportPointer,
    }),
  });
}
export async function verifyRootPolicySource(
  policy: ClipRootPolicy,
  bytes: Uint8Array,
  name: string,
): Promise<void> {
  if (policy.clipId !== name) throw new Error('Root policy clip mismatch');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== policy.sourceSha256)
    throw new Error('Root policy source mismatch');
}
export function extractedTranslation(
  raw: Vector3,
  policy?: ClipRootPolicy,
): Vector3 {
  if (policy?.mode === 'in-place-posture-xyz') return { x: 0, y: 0, z: 0 };
  return {
    x: raw.x,
    y: policy?.mode === 'grounded-posture-y' ? 0 : raw.y,
    z: raw.z,
  };
}
/** Loader gate, in addition to source/derived-artifact hashes and catalog validation. */
export function assertRootPolicyCompatibility(
  motions: readonly {
    readonly asset: MotionAsset;
    readonly rootPolicy: ClipRootPolicy;
  }[],
  visuals: { rootPolicy(id: ClipId): ClipRootPolicy | undefined },
): void {
  const seen = new Set<ClipId>();
  for (const { asset, rootPolicy } of motions) {
    const expected = copyRootPolicy(rootPolicy),
      id = asset.definition.clipId,
      actual = visuals.rootPolicy(id);
    if (
      seen.has(id) ||
      expected.clipId !== id ||
      !actual ||
      JSON.stringify(expected) !== JSON.stringify(copyRootPolicy(actual))
    )
      throw new Error('Incompatible visual/baked root policy');
    seen.add(id);
    if (
      expected.mode === 'in-place-posture-xyz' &&
      (asset.definition.rootCurve.some(
        (key) =>
          key.position.x !== 0 || key.position.y !== 0 || key.position.z !== 0,
      ) ||
        asset.ownership.some((key) => key.verticalOwner !== 'spatial-jump'))
    )
      throw new Error('In-place posture cannot own XYZ transport');
    if (
      expected.mode === 'grounded-posture-y' &&
      (asset.definition.rootCurve.some((key) => key.position.y !== 0) ||
        asset.ownership.some((key) => key.verticalOwner !== 'spatial-jump'))
    )
      throw new Error('Grounded posture cannot own vertical transport');
  }
}

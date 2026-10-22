/** A-owned diagnostic loader. Repository sources only; never a production-ready catalog. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { immutableDto } from '../../../src/app/immutableDto';
import {
  assertRootPolicyCompatibility,
  PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  type ThreeAssetPack,
} from '../../../src/assets';
import { bakeRepresentative } from '../../../tools/assets/representativeBake';

export const PINNED_REPRESENTATIVE_SHA256 =
  '3b36795776206a453fe4b888a7eab20b141f559362d118b5b6c3f934b69058bc';
const status = 'PROVISIONAL_DIAGNOSTIC_NOT_PRODUCTION_READY';
type Representative = Awaited<ReturnType<typeof bakeRepresentative>>;
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export async function regeneratePinnedRepresentatives(): Promise<Uint8Array> {
  const representatives: Representative[] = [];
  for (const [category, policy] of [
    ['punch', PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[0]],
    ['kick', PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[1]],
  ] as const) {
    if (!policy) throw new Error('Missing explicit representative policy');
    const sourcePath = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const manifestPath = `assets/android/motions/completed42-speed15/${category}/manifest.json`;
    const bytes = readFileSync(sourcePath),
      manifestBytes = readFileSync(manifestPath);
    if (
      hash(bytes) !== policy.sourceSha256 ||
      hash(manifestBytes) !== policy.provenance.manifestSha256
    )
      throw new Error('Representative source/manifest hash mismatch');
    representatives.push(
      await bakeRepresentative({
        category,
        sourcePath,
        manifestPath,
        bytes,
        manifestBytes,
        expectedGlbSha256: policy.sourceSha256,
      }),
    );
  }
  return new TextEncoder().encode(
    JSON.stringify({ status, representatives }, null, 2) + '\n',
  );
}

export function loadPinnedRepresentatives(
  bytes: Uint8Array,
  visuals: Pick<ThreeAssetPack, 'rootPolicy'>,
  readSource: (path: string) => Uint8Array = readFileSync,
): readonly Representative[] {
  if (hash(bytes) !== PINNED_REPRESENTATIVE_SHA256)
    throw new Error('Derived representative artifact hash mismatch');
  // Exact independently reviewed byte hash is checked before this typed parse. Catalog
  // prepare still validates every motion; hash equality is not visual/art acceptance.
  const bundle = JSON.parse(new TextDecoder().decode(bytes)) as {
    status: string;
    representatives: Representative[];
  };
  if (bundle.status !== status || bundle.representatives.length !== 2)
    throw new Error('Unexpected diagnostic bundle scope');
  for (const representative of bundle.representatives) {
    const source = representative.source;
    if (
      hash(readSource(source.path)) !== source.sha256 ||
      hash(readSource(source.manifestPath)) !== source.manifestSha256 ||
      source.sha256 !== representative.rootPolicy.sourceSha256 ||
      source.manifestSha256 !==
        representative.rootPolicy.provenance.manifestSha256
    )
      throw new Error('Representative source/manifest binding mismatch');
  }
  assertRootPolicyCompatibility(
    bundle.representatives.map((r) => ({
      asset: r.candidate,
      rootPolicy: r.rootPolicy,
    })),
    visuals,
  );
  return immutableDto(bundle.representatives);
}

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { authorDeathClips } from '../../src/assets/deathAnimation.ts';
import { exportDeathClipArtifact } from '../../src/assets/deathClipArtifact.ts';
import { prepareSkinBounds } from '../../src/assets/skinBounds.ts';
import { exportSkinBoundsArtifact } from '../../src/assets/skinBoundsArtifact.ts';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack.ts';
import { clipId } from '../../src/contracts/index.ts';
const [output, manifestOutput] = process.argv.slice(2);
if (!output || !manifestOutput)
  throw new Error(
    'Provide two NEW output paths for artifact JSON and pinned manifest TS',
  );
if (existsSync(output) || existsSync(manifestOutput))
  throw new Error('Artifact outputs must both be NEW paths');
const sha256 = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest('hex');
const categories = ['movement', 'jump', 'punch', 'kick'] as const;
const paths = categories.map(
  (category) =>
    `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
);
const sources = paths.map((path) => new Uint8Array(readFileSync(path)));
const sourceHashes = sources.map(sha256);
const locked: unknown = JSON.parse(
  readFileSync('tools/assets/source-lock.json', 'utf8'),
);
if (
  !locked ||
  typeof locked !== 'object' ||
  !('sources' in locked) ||
  !Array.isArray(locked.sources)
)
  throw new Error('Missing source lock');
for (let index = 0; index < paths.length; index++) {
  const found: unknown = locked.sources.find(
    (entry: unknown) =>
      entry !== null &&
      typeof entry === 'object' &&
      'path' in entry &&
      entry.path === paths[index],
  );
  if (
    !found ||
    typeof found !== 'object' ||
    !('sha256' in found) ||
    found.sha256 !== sourceHashes[index]
  )
    throw new Error('Original source lock mismatch');
}
const pack = await createThreeAssetPack(sources),
  seed = pack.create('white');
try {
  seed.seek(clipId('Idle'), 0);
  const support = exportSkinBoundsArtifact(prepareSkinBounds(seed.node));
  const deaths = exportDeathClipArtifact(authorDeathClips(seed.node));
  const artifact = { schemaVersion: 1, sourceHashes, support, deaths };
  const encoded = `${JSON.stringify(artifact)}\n`;
  const manifest = {
    schemaVersion: 1,
    url: '/game-assets/android/runtime-artifact-v1.json',
    sha256: sha256(encoded),
    bytes: Buffer.byteLength(encoded),
    sources: paths.map((path, index) => ({
      path,
      sha256: sourceHashes[index],
      bytes: sources[index]?.byteLength,
    })),
    supportAlgorithm: support.algorithm,
    deathAlgorithm: deaths.algorithm,
    scope:
      'Exact CPU support and existing canonical death tracks only; not complete motion or world-visual acceptance',
  };
  // Exclusive creation preserves every prior candidate; regeneration goes to NEW paths.
  const { sources: pins, ...descriptor } = manifest;
  const manifestCode = `// Deterministically generated offline by tools/assets/build-runtime-artifacts.mts.\nconst sourcePins = Object.freeze(${JSON.stringify(pins, null, 2)}.map(source => Object.freeze(source)));\nexport const ANDROID_RUNTIME_ARTIFACT_V1 = Object.freeze({ ...${JSON.stringify(descriptor, null, 2)}, sources: sourcePins } as const);\n`;
  const formatted = spawnSync(
    process.execPath,
    [
      'node_modules/@biomejs/biome/bin/biome',
      'format',
      '--stdin-file-path=src/assets/runtimeArtifactManifest.ts',
    ],
    { input: manifestCode, encoding: 'utf8' },
  );
  if (formatted.status !== 0)
    throw new Error(`Installed manifest formatter failed: ${formatted.stderr}`);
  writeFileSync(output, encoded, { flag: 'wx' });
  writeFileSync(manifestOutput, formatted.stdout, { flag: 'wx' });
  console.log(
    JSON.stringify({
      artifactSha256: manifest.sha256,
      bytes: manifest.bytes,
      sourceHashes,
      support: support.stats,
    }),
  );
} finally {
  seed.dispose();
  pack.dispose();
}

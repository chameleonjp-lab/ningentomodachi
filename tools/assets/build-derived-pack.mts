import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest.ts';
import { buildDerivedPack } from './derivedPack.ts';
const [output, manifestOutput] = process.argv.slice(2);
if (
  !output ||
  !manifestOutput ||
  existsSync(output) ||
  existsSync(manifestOutput)
)
  throw new Error(
    'Provide two NEW paths for derived GLB and trusted manifest TS',
  );
const sources = ANDROID_RUNTIME_ARTIFACT_V1.sources.map(
  (source) => new Uint8Array(readFileSync(source.path)),
);
const { bytes, certificate } = buildDerivedPack(sources);
const descriptor = {
  schemaVersion: 1,
  url: '/game-assets/android/derived-pack-v1.glb',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  certificateVersion: certificate.version,
  staticSha256: certificate.staticSha256,
  runtimeArtifactSha256: ANDROID_RUNTIME_ARTIFACT_V1.sha256,
  runtimeArtifactBytes: ANDROID_RUNTIME_ARTIFACT_V1.bytes,
  scope:
    'Lossless original42 representation only; no new motion annotation, root policy, world-art or responsiveness acceptance',
};
const code = `// Deterministically generated offline by tools/assets/build-derived-pack.mts.\nconst sourcePins = Object.freeze(${JSON.stringify(ANDROID_RUNTIME_ARTIFACT_V1.sources, null, 2)}.map(source => Object.freeze(source)));\nconst clipOrigins = Object.freeze(${JSON.stringify(certificate.clips, null, 2)}.map(clip => Object.freeze(clip)));\nexport const ANDROID_DERIVED_PACK_V1 = Object.freeze({ ...${JSON.stringify(descriptor, null, 2)}, sources: sourcePins, clips: clipOrigins } as const);\n`;
const formatted = spawnSync(
  process.execPath,
  [
    'node_modules/@biomejs/biome/bin/biome',
    'format',
    '--stdin-file-path=src/assets/derivedPackManifest.ts',
  ],
  { input: code, encoding: 'utf8' },
);
if (formatted.status !== 0)
  throw new Error(`Installed formatter failed: ${formatted.stderr}`);
writeFileSync(output, bytes, { flag: 'wx' });
writeFileSync(manifestOutput, formatted.stdout, { flag: 'wx' });
console.log(
  JSON.stringify({
    ...descriptor,
    sources: ANDROID_RUNTIME_ARTIFACT_V1.sources,
    clips: certificate.clips.length,
  }),
);

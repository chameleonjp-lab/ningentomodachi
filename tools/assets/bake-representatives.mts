import { readFileSync, writeFileSync } from 'node:fs';
import { bakeRepresentative } from './representativeBake.ts';
const output = process.argv[2];
if (!output)
  throw new Error(
    'Provide a NEW diagnostic JSON output path; no public catalog is written by default',
  );
const sourceLock: unknown = JSON.parse(
  readFileSync('tools/assets/source-lock.json', 'utf8'),
);
if (
  !sourceLock ||
  typeof sourceLock !== 'object' ||
  !('sources' in sourceLock) ||
  !Array.isArray(sourceLock.sources)
)
  throw new Error('Invalid source lock');
const representatives = [];
for (const category of ['punch', 'kick'] as const) {
  const sourcePath = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
  const manifestPath = `assets/android/motions/completed42-speed15/${category}/manifest.json`;
  const locked: unknown = sourceLock.sources.find(
    (entry: unknown) =>
      entry !== null &&
      typeof entry === 'object' &&
      'path' in entry &&
      entry.path === sourcePath,
  );
  if (
    !locked ||
    typeof locked !== 'object' ||
    !('sha256' in locked) ||
    typeof locked.sha256 !== 'string'
  )
    throw new Error('Missing source hash');
  representatives.push(
    await bakeRepresentative({
      category,
      sourcePath,
      manifestPath,
      bytes: readFileSync(sourcePath),
      manifestBytes: readFileSync(manifestPath),
      expectedGlbSha256: locked.sha256,
    }),
  );
}
writeFileSync(
  output,
  JSON.stringify(
    { status: 'PROVISIONAL_DIAGNOSTIC_NOT_PRODUCTION_READY', representatives },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    representatives.map(({ source, measurements }) => ({
      clip: source.clipPointer,
      path: source.path,
      ...measurements,
    })),
    null,
    2,
  ),
);

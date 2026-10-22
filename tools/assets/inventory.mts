import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { inspectGlb } from '../../src/assets/source.ts';
const sourceCommit = 'a586b99bd9ccca09d48088e323f97f12039e0ced';
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const sources = [];
for (const variant of ['completed42', 'completed42-speed15']) {
  for (const [category, count] of Object.entries({ movement: 9, jump: 1, punch: 13, kick: 19 })) {
    const path = `assets/android/motions/${variant}/${category}/android_${category}.glb`;
    const bytes = readFileSync(path);
    const inspected = inspectGlb(bytes);
    if (inspected.clips.length !== count) throw new Error(`Wrong clip count: ${path}`);
    sources.push({ path, sourceCommit, bytes: bytes.length, sha256: sha256(bytes), category, variant, runtimeRate: 1, distribution: 'existing-repository-source; new-derived-upload-not-authorized', ...inspected, skeletonSignature: sha256(inspected.skeletonSignature) });
  }
}
const receipt = { schemaVersion: 1, sourceCommit, generator: 'inventory-v2/exact-glTF-FLOAT-times/ancestor-bind-signature', sources };
const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (process.argv[2]) writeFileSync(process.argv[2], output, { flag: 'wx' });
else process.stdout.write(output);

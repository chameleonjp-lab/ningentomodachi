/** Standalone Node CPU benchmark, NOT a test, browser frame-budget or visual acceptance. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Group, SkinnedMesh } from 'three';
import { authorDeathClips, createThreeAssetPack } from '../../../src/assets';
import { clipId } from '../../../src/contracts';

const lock = JSON.parse(readFileSync('tools/assets/source-lock.json', 'utf8'));
const output = process.env.BENCHMARK_OUTPUT_FILE;
if (output && existsSync(output))
  throw new Error('Benchmark output must be a new unique file');
const sources = ['movement', 'jump', 'punch', 'kick'].map((category) => {
  const path = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
  const bytes = new Uint8Array(readFileSync(path));
  const expected = lock.sources.find((s: { path: string }) => s.path === path);
  if (
    bytes.length !== expected.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256
  )
    throw Error('Source byte verification failed');
  return bytes;
});
const started = performance.now();
const original = await createThreeAssetPack(sources),
  seed = original.create('white');
seed.seek(clipId('Idle'), 0);
const clips = authorDeathClips(seed.node);
const pack = await createThreeAssetPack(sources, {}, clips);
seed.dispose();
original.dispose();
const preparationMs = performance.now() - started;
const records = [];
for (const [name, time] of [
  ['FrontKick', 0.55],
  ['CartwheelKick', 0.9],
] as const)
  for (const count of [1, 2]) {
    const rigs = Array.from({ length: count }, () => pack.create('white'));
    const anchor = new Group(),
      presentation = new Group();
    anchor.add(presentation);
    anchor.position.y = 2;
    presentation.position.y = -1;
    let vertices = 0,
      meshes = 0;
    for (const rig of rigs) {
      presentation.add(rig.node);
      rig.node.traverse((n) => {
        if (n instanceof SkinnedMesh) {
          meshes++;
          vertices += n.geometry.getAttribute('position').count;
        }
      });
    }
    const passes = [];
    try {
      for (let pass = 0; pass < 3; pass++) {
        for (const rig of rigs) rig.seek(clipId(name), time);
        const heapBefore = process.memoryUsage().heapUsed;
        const samples = [];
        for (let frame = 0; frame <= 60; frame++) {
          const t = performance.now();
          for (const rig of rigs) rig.seek(clipId('DefeatKick'), frame / 120);
          samples.push(performance.now() - t);
        }
        const warm = samples.slice(1).sort((a, b) => a - b);
        passes.push({
          pass,
          entryMs: samples[0],
          samplesMs: samples,
          medianMs: warm[30],
          p95Ms: warm[57],
          maxMs: Math.max(...warm),
          heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
        });
      }
    } finally {
      for (const rig of rigs) {
        presentation.remove(rig.node);
        rig.dispose();
      }
    }
    records.push({ name, time, count, vertices, meshes, passes });
  }
pack.dispose();
const result = {
  runtime: process.version,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  scope:
    'Three CPU rig.seek only, complete actual skinned surface; no Vitest, no renderer, no motion-catalog query or GPU; warm passes 1-2, pass0 retained cold',
  preparationMs,
  records,
};
if (output)
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      preparationMs,
      rows: records.map((r) => ({
        name: r.name,
        count: r.count,
        vertices: r.vertices,
        warm: r.passes
          .slice(1)
          .map((p) => ({ median: p.medianMs, p95: p.p95Ms, max: p.maxMs })),
      })),
    },
    null,
    2,
  ),
);

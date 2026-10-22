/** Standalone Node CPU benchmark, NOT a test, browser frame-budget or visual acceptance. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  authorDeathClips,
  createActorAnimator,
  createThreeAssetPack,
  SOURCE_PALETTES,
} from '../../../src/assets';
import {
  type CommittedFrame,
  clipId,
  durationMs,
  presentationTimeMs,
} from '../../../src/contracts';
import { createSceneAdapter } from '../../../src/scene';
import { actor, run, state, viewport } from '../../world/fixtures';

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
const pack = await createThreeAssetPack(sources, SOURCE_PALETTES, clips);
seed.dispose();
original.dispose();
const preparationMs = performance.now() - started;
const records = [];
for (const count of [1, 2]) {
  let draws = 0;
  const context = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
  };
  const scene = createSceneAdapter(context, {
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render(world, camera) {
        world.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        draws++;
      },
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
  });
  const animation = createActorAnimator(
    { ...context, renderHost: scene.renderHost },
    {
      create: (color) => pack.create(color),
      clipDuration: (id) => pack.clipDuration(id),
      locomotionClips: {
        idle: clipId('Idle'),
        walk: clipId('Walk'),
        run: clipId('Run'),
        jump: clipId('Jump'),
      },
    },
  );
  const actors = [actor('white'), actor('blue')].slice(0, count);
  const passes = [];
  try {
    for (let pass = 0; pass < 3; pass++) {
      const initial = state(pass * 1000, { actors });
      const initialFrame = {
        snapshot: initial,
        spatial: scene.commit({ snapshot: initial, events: [] }, viewport),
        events: [],
        viewport,
      };
      animation.render(initialFrame);
      scene.render(initialFrame);
      const samples = [];
      const heapBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i <= 120; i++) {
        const presentation = pass * 3000 + i * (2000 / 120);
        const snapshot = state(pass * 1000 + i + 1, {
          actors: actors.map((a) => ({
            ...a,
            defeated: true,
            hp: 0,
            defeatPresentation: {
              category: 'kick',
              startedAt: presentationTimeMs(pass * 3000),
              slowDurationMs: durationMs(2000),
              playbackRate: 0.25,
            },
          })),
          clocks: {
            ...initial.clocks,
            presentationTimeMs: presentationTimeMs(presentation),
          },
        });
        const t = performance.now();
        const spatial = scene.commit({ snapshot, events: [] }, viewport);
        const frame: CommittedFrame = {
          snapshot,
          spatial,
          events: [],
          viewport,
        };
        animation.render(frame);
        scene.render(frame);
        samples.push(performance.now() - t);
      }
      const warm = samples.slice(1).sort((a, b) => a - b);
      passes.push({
        pass,
        entryMs: samples[0],
        samplesMs: samples,
        medianMs: warm[60],
        p95Ms: warm[114],
        maxMs: Math.max(...warm),
        heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      });
    }
  } finally {
    animation.dispose();
    scene.dispose();
  }
  if (draws !== 366)
    throw new Error(`Expected exactly one draw per frame, got ${draws}`);
  records.push({ count, draws, passes });
}
pack.dispose();
const result = {
  runtime: process.version,
  cpu: cpus()[0]?.model,
  preparationMs,
  scope:
    'Standalone Node CPU: actual C commit, public B Animator seek/support publication, C staging validation/settlement/camera/render with matrix-update renderer stub; one draw per frame. No GPU, browser, gameplay motor, catalog query or device claim. Cold authoring/certification preparation retained separately.',
  records,
};
if (output)
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));

import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createPinnedThreeAssetPack } from '../../src/assets/runtimeArtifacts.ts';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest.ts';
import { PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES } from '../../src/assets/representativePolicies.ts';

// One fresh-process sample; not a browser/device responsiveness certification.
// Fetch/file IO and module startup are outside this measured preparation boundary.
const manifest = ANDROID_RUNTIME_ARTIFACT_V1;
const sources = manifest.sources.map(
  (source) => new Uint8Array(readFileSync(source.path)),
);
const artifactBytes = new Uint8Array(readFileSync(`public${manifest.url}`));
const events: {
  stage: string;
  elapsedMs: number;
  sincePreviousCheckpointMs: number;
}[] = [];
let previousTimer = performance.now(),
  maxTimerSpacingMs = 0;
const timer = setInterval(() => {
  const now = performance.now();
  maxTimerSpacingMs = Math.max(maxTimerSpacingMs, now - previousTimer);
  previousTimer = now;
}, 1);
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const start = performance.now();
let previousCheckpoint = start;
const pending = createPinnedThreeAssetPack({
  sources,
  artifactBytes,
  signal: new AbortController().signal,
  rootPolicies: PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  checkpoint: async (stage) => {
    const now = performance.now();
    events.push({
      stage,
      elapsedMs: now - start,
      sincePreviousCheckpointMs: now - previousCheckpoint,
    });
    previousCheckpoint = now;
  },
});
const initialSynchronousCallMs = performance.now() - start;
try {
  const pack = await pending;
  const factoryMs = performance.now() - start;
  clearInterval(timer);
  const createStart = performance.now(),
    white = pack.create('white');
  const whiteCreateMs = performance.now() - createStart;
  const blackStart = performance.now(),
    black = pack.create('black');
  const blackCreateMs = performance.now() - blackStart;
  try {
    if (
      typeof white.defeatPoseSupport !== 'function' ||
      typeof black.defeatPoseSupport !== 'function'
    )
      throw new Error('Bounds capability missing');
    console.log(
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model,
          artifactSha256: manifest.sha256,
          scope:
            'Complete one-pack pinned factory plus separately measured synchronous white/black instantiation. Source IO/module startup excluded; no renderer, browser, GPU or device acceptance.',
          initialSynchronousCallMs,
          factoryMs,
          whiteCreateMs,
          blackCreateMs,
          maxTimerSpacingMs,
          timerInterpretation:
            'Observed 1 ms timer spacing is an event-loop blocking indicator, not an exact profiler attribution. Checkpoint spans include scheduled waits and asynchronous work, so they are conservative operation bounds, not all synchronous CPU.',
          longestCheckpointSpans: [...events]
            .sort(
              (a, b) =>
                b.sincePreviousCheckpointMs - a.sincePreviousCheckpointMs,
            )
            .slice(0, 12),
          events,
        },
        null,
        2,
      ),
    );
  } finally {
    white.dispose();
    black.dispose();
    pack.dispose();
  }
} finally {
  clearInterval(timer);
}

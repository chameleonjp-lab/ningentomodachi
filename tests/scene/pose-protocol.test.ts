import { expect, test } from 'vitest';
import { createSceneAdapter } from '../../src/scene';
import { run, viewport } from '../world/fixtures';
test('scene exposes only its actual captured deterministic engine capability', () => {
  const context = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    posePolicy: { version: 1 as const, mode: 'deterministic-pose-v1' as const },
  };
  const options = {
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render() {},
      dispose() {},
      setSize() {},
      setPixelRatio() {},
    }),
  };
  const v1 = createSceneAdapter(context, options);
  const legacy = createSceneAdapter(
    { runId: run, seed: 1, viewport: context.viewport },
    options,
  );
  try {
    expect(v1.poseProtocol).toMatchObject({
      version: 1,
      protocol: 'deterministic-pose-v1',
    });
    expect(typeof v1.poseProtocol?.bindPreparedCatalog).toBe('function');
    expect(legacy.poseProtocol).toBeUndefined();
  } finally {
    v1.dispose();
    legacy.dispose();
  }
});

import {
  clipId,
  durationMs,
  gameTimeMs,
  commandId,
  actorId,
  type PoseCatalogBindings,
  type SpatialSnapshot,
} from '../../src/contracts';
import { state, catalog } from '../world/fixtures';
function renderTrace(hz: number) {
  const context = {
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    posePolicy: { version: 1 as const, mode: 'deterministic-pose-v1' as const },
  };
  const scene = createSceneAdapter(context, {
    onInterruption() {},
    createRenderer: () => ({
      domElement: new EventTarget() as HTMLCanvasElement,
      render() {},
      dispose() {},
      setSize() {},
      setPixelRatio() {},
    }),
  });
  const descriptor: PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'scene-set',
    clips: ['idle', 'walk', 'run', 'jump'].map((n) => ({
      clipId: clipId(n),
      durationMs: durationMs(100),
      sourceBindingId: n,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  scene.poseProtocol!.bindPreparedCatalog(descriptor);
  const trace: SpatialSnapshot[] = [];
  let renderAt = 0;
  try {
    scene.commit({ snapshot: state(0), events: [] }, viewport);
    for (let n = 1; n <= 150; n++) {
      const now = n * 10;
      const snapshot = {
        ...state(n),
        clocks: { ...state(n).clocks, gameTimeMs: gameTimeMs(now) },
      };
      const intents =
        n === 1
          ? [
              {
                type: 'JumpRequested' as const,
                runId: run,
                actorId: actorId('white'),
                input: { commandId: commandId('jump'), sequence: 1 },
              },
            ]
          : [];
      scene.step(
        { snapshot, step: { durationMs: durationMs(10) }, intents },
        catalog(),
      );
      const spatial = scene.commit({ snapshot, events: [] }, viewport);
      trace.push(spatial);
      if (hz)
        while (renderAt <= now) {
          scene.render({ snapshot, spatial, events: [], viewport });
          renderAt += 1000 / hz;
        }
    }
    return trace;
  } finally {
    scene.dispose();
  }
}
test('actual C renderer at zero/30/60/120Hz cannot alter simulation stamps or jump/landing epochs', () => {
  const noDraw = renderTrace(0);
  expect(
    new Set(
      noDraw.map((s) =>
        s.actors[0]!.pose?.kind === 'living'
          ? s.actors[0]!.pose.living.mode
          : '',
      ),
    ),
  ).toEqual(new Set(['jump', 'idle']));
  for (const hz of [30, 60, 120]) expect(renderTrace(hz)).toEqual(noDraw);
});

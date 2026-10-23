import { expect, test } from 'vitest';
import { createPresentationLayoutCapture } from '../../src/app/presentationLayout';
import {
  runId,
  type PresentationLayout,
  type ViewportSnapshot,
} from '../../src/contracts';
const run = runId('layout-run');
const viewport: ViewportSnapshot = {
  revision: 2,
  widthCssPx: 800,
  heightCssPx: 400,
  offsetLeftCssPx: 30,
  offsetTopCssPx: 20,
  devicePixelRatio: 2,
  safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
};
function layout(): PresentationLayout {
  return {
    runId: run,
    viewportRevision: 2,
    layoutRevision: 0,
    rects: [{ id: 'player-status', left: 10, top: 20, right: 100, bottom: 80 }],
  };
}
test('captures detached immutable layout and distinguishes empty from unavailable', () => {
  const capture = createPresentationLayoutCapture();
  const input = layout();
  const result = capture(input, run, viewport);
  expect(result).toEqual(input);
  expect(result).not.toBe(input);
  expect(Object.isFrozen(result?.rects[0])).toBe(true);
  expect(capture(undefined, run, viewport)).toBeUndefined();
  expect(
    capture({ ...layout(), layoutRevision: 1, rects: [] }, run, viewport)
      ?.rects,
  ).toEqual([]);
});
test('rejects stale revisions and changed geometry under the same revision without reviving unavailable data', () => {
  const capture = createPresentationLayoutCapture();
  const a = { ...layout(), layoutRevision: 3 };
  expect(capture(a, run, viewport)).toBeDefined();
  expect(capture({ ...a, rects: [] }, run, viewport)).toBeUndefined();
  expect(capture({ ...a, layoutRevision: 2 }, run, viewport)).toBeUndefined();
  expect(capture(undefined, run, viewport)).toBeUndefined();
  expect(capture(a, run, viewport)).toEqual(a);
  expect(
    capture({ ...layout(), runId: runId('next') }, runId('next'), viewport),
  ).toBeDefined();
});
test('captures every field getter once and never revalidates a changing caller object', () => {
  const count: Record<string, number> = {};
  const value = layout();
  const wrap = (object: object) =>
    Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, item]),
    );
  const rect = wrap(value.rects[0]!);
  for (const [key, item] of Object.entries(rect))
    Object.defineProperty(rect, key, {
      get() {
        count[key] = (count[key] ?? 0) + 1;
        return count[key] === 1 ? item : NaN;
      },
    });
  const input = { ...value, rects: [rect] };
  const result = createPresentationLayoutCapture()(input, run, viewport);
  expect(result?.rects[0]).toEqual(value.rects[0]);
  expect(Object.values(count)).toEqual([1, 1, 1, 1, 1]);
});
test.each([
  { runId: runId('wrong') },
  { viewportRevision: 1 },
  { layoutRevision: -1 },
  { layoutRevision: 0.5 },
  { rects: Array(9).fill(layout().rects[0]) },
  { rects: [layout().rects[0], layout().rects[0]] },
  ...['left', 'top', 'right', 'bottom'].map((key) => ({
    rects: [{ ...layout().rects[0], [key]: NaN }],
  })),
  { rects: [{ ...layout().rects[0], id: 'swipe' }] },
  { rects: [{ ...layout().rects[0], left: -1 }] },
  { rects: [{ ...layout().rects[0], right: 801 }] },
  { rects: [{ ...layout().rects[0], bottom: 401 }] },
  { rects: [{ ...layout().rects[0], right: 10 }] },
  { rects: [{ ...layout().rects[0], top: 80 }] },
])('rejects malformed or stale descriptor %j', (patch) => {
  expect(
    createPresentationLayoutCapture()({ ...layout(), ...patch }, run, viewport),
  ).toBeUndefined();
});
test('malformed accessor is unavailable, and next valid layout still qualifies', () => {
  const capture = createPresentationLayoutCapture();
  expect(
    capture(
      {
        get rects() {
          throw new Error('bad descriptor');
        },
      },
      run,
      viewport,
    ),
  ).toBeUndefined();
  expect(capture(layout(), run, viewport)).toBeDefined();
});

import { createFrameLoop } from '../../src/app/frameLoop';
import { createGame } from '../../src/app/createGame';
import { createFixturePorts } from '../core/fixtures/ports';
import { createScriptedCore } from '../core/fixtures/scriptedCore';
import type { CommittedFrame, UiPort } from '../../src/contracts';
function publication(prepareLayout?: UiPort['prepareLayout']) {
  const fixtures = createFixturePorts();
  const trace: string[] = [];
  const frames: CommittedFrame[] = [];
  let reads = 0;
  const reader = {
    read: () => {
      reads++;
      return viewport;
    },
    subscribe: () => () => {},
  };
  const context = { runId: run, seed: 1, viewport: reader };
  const scripted = createScriptedCore({ runId: run, seed: 1 });
  const spatial = fixtures.factories.spatial(context);
  const loop = createFrameLoop(
    {
      core: scripted.core,
      catalog: fixtures.factories.catalog(context),
      viewport: reader,
      animation: {
        dispose() {},
        render(frame) {
          trace.push('animation');
          frames.push(frame);
        },
      },
      spatial: {
        ...spatial,
        commit(output, v) {
          trace.push('commit');
          return spatial.commit(output, v);
        },
        render(frame) {
          trace.push('spatial');
          frames.push(frame);
        },
        project(frame) {
          trace.push('project');
          frames.push(frame);
          return [];
        },
      },
      ui: {
        dispose() {},
        ...(prepareLayout
          ? {
              prepareLayout(frame: CommittedFrame) {
                trace.push('prepare');
                expect(Object.isFrozen(frame.viewport)).toBe(true);
                return prepareLayout(frame);
              },
            }
          : {}),
        render(frame) {
          trace.push('ui');
          frames.push(frame);
        },
      },
    },
    { stepMs: 20, maxStepsPerFrame: 1 },
    {
      committed() {
        trace.push('committed');
      },
    },
  );
  return { loop, scripted, trace, frames, reads: () => reads };
}
test('prepares once after commit/hook and publishes identical immutable final frame to all consumers', () => {
  let prepared: CommittedFrame | undefined;
  const p = publication((frame) => {
    prepared = frame;
    return layout();
  });
  p.loop.publish(p.scripted.core.drain());
  expect(p.trace).toEqual([
    'commit',
    'committed',
    'prepare',
    'animation',
    'spatial',
    'project',
    'ui',
  ]);
  expect(p.reads()).toBe(1);
  expect(p.frames).toHaveLength(4);
  for (const frame of p.frames) expect(frame).toBe(p.frames[0]);
  expect(p.frames[0]).not.toBe(prepared);
  expect(prepared?.presentationLayout).toBeUndefined();
  expect(p.frames[0]?.presentationLayout).toEqual(layout());
  expect(p.frames[0]?.events).toBe(prepared?.events);
});
test('absent provider preserves legacy order and unavailable never carries prior geometry', () => {
  const legacy = publication();
  legacy.loop.publish(legacy.scripted.core.drain());
  expect(legacy.trace).toEqual([
    'commit',
    'committed',
    'animation',
    'spatial',
    'project',
    'ui',
  ]);
  let available = true;
  const p = publication(() => (available ? layout() : undefined));
  p.loop.publish(p.scripted.core.drain());
  available = false;
  p.loop.publish(p.scripted.core.drain());
  expect(p.frames[4]?.presentationLayout).toBeUndefined();
  expect(p.reads()).toBe(2);
});
test('preparation errors stop before any presentation write and preserve the original exception', () => {
  const error = new Error('layout prepare failed');
  const p = publication(() => {
    throw error;
  });
  expect(() => p.loop.publish(p.scripted.core.drain())).toThrow(error);
  expect(p.frames).toHaveLength(0);
  expect(p.trace).toEqual(['commit', 'committed', 'prepare']);
});
test('paused and loading publications remain unavailable when UI cannot qualify their layout', () => {
  const p = publication(() => undefined);
  for (const phase of ['loading', 'paused'] as const) {
    p.scripted.script({ phase });
    p.loop.publish(p.scripted.core.drain());
    expect(p.frames.at(-1)?.snapshot.phase).toBe(phase);
    expect(p.frames.at(-1)?.presentationLayout).toBeUndefined();
  }
});
test('host preparation failure drains existing run resource ownership', async () => {
  const f = createFixturePorts();
  const error = new Error('layout prepare failed');
  const game = createGame(
    {
      ...f.factories,
      ui: (context) => ({
        ...f.factories.ui(context),
        prepareLayout() {
          throw error;
        },
      }),
    },
    { sessionId: 'layout-failure', seed: 1 },
  );
  await expect(game.start()).rejects.toThrow(error);
  expect(f.trace).toContain('ui.dispose');
  expect(f.trace).toContain('animation.dispose');
  expect(f.trace).toContain('spatial.dispose');
  game.dispose();
});

test('captures descriptor getters once, including the rectangle array, and detaches caller mutation', () => {
  const original = layout();
  const counts: Record<string, number> = {};
  const input = Object.fromEntries(Object.entries(original));
  for (const [key, value] of Object.entries(original))
    Object.defineProperty(input, key, {
      get() {
        counts[key] = (counts[key] ?? 0) + 1;
        return counts[key] === 1 ? value : undefined;
      },
    });
  const captured = createPresentationLayoutCapture()(input, run, viewport);
  expect(captured).toEqual(original);
  expect(Object.values(counts)).toEqual([1, 1, 1, 1]);
  Object.assign(original.rects[0]!, { left: 11 });
  expect(captured?.rects[0]?.left).toBe(10);
  expect(() => {
    Object.assign(captured!.rects[0]!, { left: 12 });
  }).toThrow();
});
test('viewport changes need a new layout revision and never accept the old viewport descriptor', () => {
  const capture = createPresentationLayoutCapture();
  expect(capture(layout(), run, viewport)).toBeDefined();
  const nextViewport = { ...viewport, revision: 3 };
  expect(capture(layout(), run, nextViewport)).toBeUndefined();
  expect(
    capture({ ...layout(), viewportRevision: 3 }, run, nextViewport),
  ).toBeUndefined();
  expect(
    capture(
      { ...layout(), viewportRevision: 3, layoutRevision: 1 },
      run,
      nextViewport,
    ),
  ).toBeDefined();
});
test('all eight declared exclusion IDs are admitted and no extra ID is inferred', () => {
  const ids = [
    'player-status',
    'opponent-status',
    'settings',
    'pause',
    'punch',
    'kick',
    'jump',
    'notice',
  ];
  const value = {
    ...layout(),
    rects: ids.map((id) => ({ ...layout().rects[0], id })),
  };
  expect(
    createPresentationLayoutCapture()(value, run, viewport)?.rects,
  ).toHaveLength(8);
});

test.each(['absent', 'invalid', 'unavailable'] as const)(
  'rejects CoreOutput-smuggled presentation authority with %s UI',
  (mode) => {
    let seen: CommittedFrame | undefined;
    const p = publication(
      mode === 'absent'
        ? undefined
        : (frame) => {
            seen = frame;
            return mode === 'invalid'
              ? { ...layout(), viewportRevision: 1 }
              : undefined;
          },
    );
    const output = { ...p.scripted.core.drain(), presentationLayout: layout() };
    p.loop.publish(output);
    expect(seen?.presentationLayout).toBeUndefined();
    for (const frame of p.frames)
      expect(frame.presentationLayout).toBeUndefined();
  },
);

test('never evaluates an unknown CoreOutput presentationLayout getter', () => {
  const p = publication();
  let reads = 0;
  const output = {
    ...p.scripted.core.drain(),
    get presentationLayout() {
      reads++;
      throw new Error('untrusted layout getter');
    },
  };
  expect(() => p.loop.publish(output)).not.toThrow();
  expect(reads).toBe(0);
  expect(p.frames[0]?.presentationLayout).toBeUndefined();
});

test.each([NaN, -1, 0.5, Infinity, '0', 9])(
  'rejects malformed array proxy length %s after exactly one read',
  (length) => {
    let reads = 0;
    const rects = new Proxy([], {
      get(target, key, receiver) {
        if (key === 'length') {
          reads++;
          return length;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      createPresentationLayoutCapture()({ ...layout(), rects }, run, viewport),
    ).toBeUndefined();
    expect(reads).toBe(1);
  },
);
test('captures a valid array proxy length once, including explicitly measured empty', () => {
  for (const source of [[], [...layout().rects]]) {
    let reads = 0;
    const rects = new Proxy(source, {
      get(target, key, receiver) {
        if (key === 'length') {
          reads++;
          return reads === 1 ? target.length : NaN;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      createPresentationLayoutCapture()({ ...layout(), rects }, run, viewport)
        ?.rects,
    ).toEqual(source);
    expect(reads).toBe(1);
  }
});

import { Vector3 as ThreeVector3 } from 'three';
import { createSceneAdapter } from '../../src/scene';
import { createParisStreetLayout } from '../../src/world/street-layout';
import {
  state as worldState,
  run as worldRun,
  catalog as worldCatalog,
} from '../world/fixtures';
function actualScenePublication(mode: 'legacy' | 'empty' | 'header' | 'stale') {
  const view = {
    ...viewport,
    safeAreaCssPx: { top: 20, right: 0, bottom: 20, left: 0 },
  };
  const reader = { read: () => view, subscribe: () => () => {} };
  const core = createScriptedCore({ runId: worldRun, seed: 1 }).core;
  const street = createParisStreetLayout();
  let position: ThreeVector3 | undefined;
  const rendered: CommittedFrame[] = [];
  const scene = createSceneAdapter(
    { runId: worldRun, seed: 1, viewport: reader },
    {
      layout: {
        ...street,
        objects: [],
        actorSpawns: { ...street.actorSpawns, blue: { x: 0, y: 0, z: 1.5 } },
      },
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render(_scene, camera) {
          position = camera.position.clone();
        },
        dispose() {},
        setPixelRatio() {},
        setSize() {},
      }),
    },
  );
  const output = { snapshot: worldState(), events: [] };
  const original = JSON.stringify(output);
  const loop = createFrameLoop(
    {
      core,
      catalog: worldCatalog(),
      viewport: reader,
      spatial: scene,
      animation: {
        dispose() {},
        render(frame) {
          rendered.push(frame);
        },
      },
      ui: {
        dispose() {},
        prepareLayout(frame) {
          expect(frame.presentationLayout).toBeUndefined();
          if (mode === 'legacy') return undefined;
          return {
            runId: worldRun,
            viewportRevision:
              mode === 'stale' ? view.revision - 1 : view.revision,
            layoutRevision: 0,
            rects:
              mode === 'empty'
                ? []
                : [
                    {
                      id: 'player-status',
                      left: 12,
                      top: 28,
                      right: 340,
                      bottom: 110,
                    },
                    {
                      id: 'opponent-status',
                      left: 460,
                      top: 28,
                      right: 788,
                      bottom: 90,
                    },
                  ],
          };
        },
        render(frame) {
          rendered.push(frame);
        },
      },
    },
    { stepMs: 20, maxStepsPerFrame: 1 },
  );
  try {
    loop.publish(output);
    expect(JSON.stringify(output)).toBe(original);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toBe(rendered[1]);
    if (!position) throw new Error('No actual scene draw camera');
    return { position, layout: rendered[0]?.presentationLayout };
  } finally {
    scene.dispose();
    core.dispose();
  }
}
test('host measured layout reaches the actual scene draw camera and changes verified framing', () => {
  const empty = actualScenePublication('empty'),
    header = actualScenePublication('header');
  expect(empty.layout?.rects).toHaveLength(0);
  expect(header.layout?.rects).toHaveLength(2);
  expect(header.position.distanceTo(empty.position)).toBeGreaterThan(0.01);
});
test('host rejects stale measured layout before actual scene and preserves legacy camera exactly', () => {
  const legacy = actualScenePublication('legacy'),
    stale = actualScenePublication('stale');
  expect(stale.layout).toBeUndefined();
  expect(stale.position.toArray()).toEqual(legacy.position.toArray());
});

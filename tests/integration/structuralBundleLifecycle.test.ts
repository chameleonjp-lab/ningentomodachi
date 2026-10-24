// @vitest-environment jsdom
import { Group } from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import {
  clipId,
  durationMs,
  type ActorColor,
  type MoveSet,
} from '../../src/contracts';
import type { MotionAsset } from '../../src/assets';
import type { ClipRootPolicy } from '../../src/assets/rootPolicy';
import type { ThreeAssetPack } from '../../src/assets/threeAssetPack';
import type { AcceptedGameConfiguration } from '../../src/app/integratedGame';
import { prepareGameAssetBundle } from '../../src/app/prepareGameAssetBundle';
import { mountApplication } from '../../src/app/mountApplication';
import { createParisStreetLayout } from '../../src/scene';

// Synthetic structural fixtures only: 12 punches + 19 kicks do not establish
// source authenticity, gameplay acceptance, production readiness, or device QA.
function fixture() {
  const motions: MotionAsset[] = ['punch', 'kick'].flatMap((category) =>
    Array.from({ length: category === 'kick' ? 19 : 12 }, (_, i) => ({
      definition: {
        clipId: clipId(`${category}:${i}`),
        category: category as 'punch' | 'kick',
        durationMs: durationMs(100),
        effectiveRangeM: 1,
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(20),
            endMs: durationMs(80),
            damageShare: 1,
            shapeId: 'strike',
          },
        ],
        rootCurve: [0, 100].map((t) => ({
          atMs: durationMs(t),
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        })),
        sampling: {
          version: 1,
          sampleRateHz: 100,
          interpolation: 'piecewise-linear',
        },
      },
      shapes: [
        {
          shapeId: 'strike',
          keys: [0, 100].map((t) => ({
            atMs: durationMs(t),
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 1, z: 1 },
              radiusM: 0.2,
            },
          })),
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'spatial-movement',
          verticalOwner: 'spatial-jump',
        },
      ],
    })),
  );
  const kicks = motions
      .filter((m) => m.definition.category === 'kick')
      .map((m) => m.definition.clipId),
    punches = motions
      .filter((m) => m.definition.category === 'punch')
      .map((m) => m.definition.clipId);
  const normal: MoveSet = {
    punches: punches.slice(0, 4),
    kicks: kicks.slice(0, 4),
  };
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    blue: normal,
    green: normal,
    yellow: normal,
    black: { punches: [], kicks },
  };
  const policies: ClipRootPolicy[] = motions.map((motion, index) => ({
    version: 1,
    clipId: motion.definition.clipId,
    sourceSha256: 'a'.repeat(64),
    mode: 'grounded-posture-y',
    provenance: {
      manifestSha256: 'b'.repeat(64),
      clipPointer: `/clips/${index}`,
      supportPointer: `/clips/${index}/support_contacts`,
    },
  }));
  const layout = createParisStreetLayout();
  function pack(badDuration = false) {
    const nodes: Group[] = [];
    const dispose = vi.fn();
    const visual: ThreeAssetPack = {
      create() {
        const node = new Group();
        nodes.push(node);
        return { node, seek() {}, setEmissiveEnabled() {}, dispose() {} };
      },
      clipDuration: (id) =>
        durationMs(
          id.startsWith('Defeat')
            ? 500
            : badDuration && id === 'punch:0'
              ? 101
              : 100,
        ),
      clipNames: () => [],
      rootPolicy: (id) => policies.find((p) => p.clipId === id),
      dispose,
    };
    return { visual, nodes, dispose };
  }
  const config: AcceptedGameConfiguration = {
    moves,
    layout,
    world: {
      vehicles: layout.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
      })),
      objects: layout.objects.map((o) => ({
        objectId: o.objectId,
        durability: 100,
      })),
    },
    loadAssets: (_context, signal) =>
      prepareGameAssetBundle({
        motions: motions.map((asset, index) => {
          const rootPolicy = policies[index];
          if (!rootPolicy) throw new Error('Missing synthetic policy');
          return { asset, rootPolicy };
        }),
        locomotionClips: {
          idle: clipId('idle'),
          walk: clipId('walk'),
          run: clipId('run'),
          jump: clipId('jump'),
        },
        signal,
        loadVisuals: (_policies, loaderSignal) => loadVisuals(loaderSignal),
      }),
  };
  let loadVisuals: (signal: AbortSignal) => Promise<ThreeAssetPack> =
    async () => pack().visual;
  return {
    config,
    pack,
    setLoader(loader: typeof loadVisuals) {
      loadVisuals = loader;
    },
  };
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function mount(config: AcceptedGameConfiguration) {
  const root = document.createElement('main'),
    caller = document.createElement('span');
  caller.textContent = 'caller-owned';
  root.append(caller);
  document.body.append(root);
  const app = mountApplication(root, {
    sessionId: 'structural-only',
    seed: 1,
    configuration: config,
    createRenderer: () => ({
      domElement: document.createElement('canvas'),
      render() {},
      dispose() {},
      setPixelRatio() {},
      setSize() {},
    }),
    browserHost: {
      requestFrame: () => 1,
      cancelFrame() {},
      subscribe: () => () => {},
    },
  });
  cleanups.push(() => {
    app.dispose();
    root.remove();
  });
  return { app, root, caller };
}
function punch(root: HTMLElement) {
  const button = Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent === 'パンチ',
  );
  if (!button) throw new Error('Missing punch control');
  button.click();
}

test('structural bundle with one mismatched visual fails closed, then valid fresh bundle reaches ready', async () => {
  const f = fixture(),
    bad = f.pack(true),
    good = f.pack();
  f.setLoader(async () => bad.visual);
  const { app, root } = mount(f.config);
  await app.ready;
  await expect(app.game.start()).rejects.toThrow(
    /Attack animation\/catalog duration mismatch: punch:0/,
  );
  expect(app.game.hostState().phase).toBe('error');
  expect(root.querySelectorAll('canvas')).toHaveLength(0);
  expect(bad.dispose).toHaveBeenCalledTimes(1);
  f.setLoader(async () => good.visual);
  await app.game.restart();
  expect(app.game.read()?.phase).toBe('ready');
  expect(root.querySelectorAll('canvas')).toHaveLength(1);
  expect(good.dispose).not.toHaveBeenCalled();
});

test('structural bundle keeps input gated until start and releases owned DOM and pack exactly once', async () => {
  const f = fixture(),
    pack = f.pack();
  f.setLoader(async () => pack.visual);
  const { app, root, caller } = mount(f.config);
  await app.ready;
  await app.game.start();
  expect(app.game.read()?.phase).toBe('ready');
  punch(root);
  app.game.advance(20);
  expect(app.game.read()?.actors[0]?.attack).toBeNull();
  const snapshot = app.game.read();
  if (!snapshot) throw new Error('Missing ready snapshot');
  const id = snapshot.runId;
  app.game.dispatch({ type: 'StartRequested', runId: id });
  punch(root);
  app.game.advance(20);
  expect(app.game.read()?.actors[0]?.attack?.category).toBe('punch');
  expect(app.game.read()?.phase).toBe('running');
  expect(pack.nodes).toHaveLength(2);
  app.dispose();
  app.dispose();
  expect(pack.dispose).toHaveBeenCalledTimes(1);
  expect(pack.nodes.every((node) => node.parent === null)).toBe(true);
  expect(root.children).toHaveLength(1);
  expect(root.firstChild).toBe(caller);
});

test('late cancelled structural pack cannot replace a fresh ready run or close its input gate', async () => {
  const f = fixture(),
    stale = f.pack(),
    fresh = f.pack();
  let resolve!: (pack: ThreeAssetPack) => void;
  let oldSignal: AbortSignal | undefined;
  f.setLoader((signal) => {
    oldSignal = signal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const { app, root } = mount(f.config);
  await app.ready;
  const pending = app.game.start();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  app.game.stop();
  expect(oldSignal?.aborted).toBe(true);
  f.setLoader(async () => fresh.visual);
  await app.game.restart();
  const ready = app.game.read();
  if (!ready) throw new Error('Missing fresh ready snapshot');
  expect(ready.phase).toBe('ready');
  const canvas = root.querySelector('canvas');
  resolve(stale.visual);
  await pending;
  expect(stale.dispose).toHaveBeenCalledTimes(1);
  expect(stale.nodes).toHaveLength(0);
  expect(fresh.dispose).not.toHaveBeenCalled();
  expect(app.game.read()?.runId).toBe(ready?.runId);
  expect(app.game.read()?.phase).toBe('ready');
  expect(root.querySelector('canvas')).toBe(canvas);
  expect(root.querySelectorAll('canvas')).toHaveLength(1);
  app.game.dispatch({ type: 'StartRequested', runId: ready.runId });
  punch(root);
  app.game.advance(20);
  expect(app.game.read()?.actors[0]?.attack?.category).toBe('punch');
});

test('dispose during structural loading preserves caller DOM and releases late pack once', async () => {
  const f = fixture(),
    late = f.pack();
  let resolve!: (pack: ThreeAssetPack) => void;
  f.setLoader(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { app, root, caller } = mount(f.config);
  await app.ready;
  const pending = app.game.start();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  app.dispose();
  app.dispose();
  resolve(late.visual);
  await pending;
  expect(late.dispose).toHaveBeenCalledTimes(1);
  expect(late.nodes).toHaveLength(0);
  expect(root.children).toHaveLength(1);
  expect(root.firstChild).toBe(caller);
  expect(app.game.read()).toBeNull();
});

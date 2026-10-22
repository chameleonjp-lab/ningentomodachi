// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import {
  clipId,
  durationMs,
  type ActorColor,
  type MoveSet,
} from '../../src/contracts';
import { createParisStreetLayout } from '../../src/scene';
import type { MotionAsset } from '../../src/assets';
import {
  createIntegratedGame,
  type AcceptedGameConfiguration,
} from '../../src/app/integratedGame';
function fixture() {
  const rigs = new Map<ActorColor, Group>();
  const motions: MotionAsset[] = ['punch', 'kick'].flatMap((category) =>
    Array.from({ length: category === 'kick' ? 19 : 4 }, (_, i) => ({
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
  const normal: MoveSet = { punches, kicks: kicks.slice(0, 4) };
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    blue: normal,
    green: normal,
    yellow: normal,
    black: { punches: [], kicks },
  };
  const layout = createParisStreetLayout(),
    dispose = vi.fn(),
    rigDispose = vi.fn(),
    seek = vi.fn();
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
    loadAssets: async () => ({
      motions,
      animator: {
        create: (color) => {
          const node = new Group();
          rigs.set(color, node);
          return {
            node,
            seek,
            setEmissiveEnabled() {},
            dispose: rigDispose,
          };
        },
        clipDuration: (id) => durationMs(id.startsWith('Defeat') ? 500 : 100),
        locomotionClips: {
          idle: clipId('idle'),
          walk: clipId('walk'),
          run: clipId('run'),
          jump: clipId('jump'),
        },
        dispose,
      },
    }),
  };
  return { config, dispose, rigDispose, seek, rigs };
}
function root() {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}
function renderer() {
  return {
    domElement: document.createElement('canvas'),
    render: vi.fn(),
    dispose: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
  };
}
const viewport = {
  widthCssPx: 800,
  heightCssPx: 600,
  offsetLeftCssPx: 0,
  offsetTopCssPx: 0,
  devicePixelRatio: 1,
  safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
};
test.each(['vehicles', 'objects'] as const)(
  'layout rejects duplicate %s IDs before preparing assets',
  async (kind) => {
    const f = fixture(),
      node = root(),
      layout = f.config.layout ?? createParisStreetLayout();
    const loadAssets = vi.fn(f.config.loadAssets);
    const firstVehicle = layout.vehicles[0],
      firstObject = layout.objects[0];
    if (!firstVehicle || !firstObject)
      throw new Error('Missing layout fixtures');
    const duplicated =
      kind === 'vehicles'
        ? {
            ...layout,
            vehicles: layout.vehicles.map((v, i) =>
              i === 1 ? firstVehicle : v,
            ),
          }
        : {
            ...layout,
            objects: layout.objects.map((v, i) => (i === 1 ? firstObject : v)),
          };
    const game = createIntegratedGame(node, {
      sessionId: `duplicate-${kind}`,
      seed: 1,
      viewport,
      createRenderer: renderer,
      configuration: { ...f.config, layout: duplicated, loadAssets },
    });
    try {
      await expect(game.start()).rejects.toThrow(
        'Core durability IDs must match the scene layout',
      );
      expect(loadAssets).not.toHaveBeenCalled();
    } finally {
      game.dispose();
    }
  },
);

test('missing accepted production config fails closed and never allocates renderer or catalog', async () => {
  const make = vi.fn(renderer);
  const game = createIntegratedGame(root(), {
    sessionId: 'missing',
    seed: 1,
    viewport,
    createRenderer: make,
  });
  expect(game.hostState().phase).toBe('title');
  await expect(game.start()).rejects.toThrow(/accepted|承認/);
  expect(game.read()).toBeNull();
  expect(game.hostState().phase).toBe('error');
  expect(make).not.toHaveBeenCalled();
  game.dispose();
});
test('real public B/C/D factories share one renderer, exact AI session service, pause/restart disposal', async () => {
  const f = fixture(),
    r = renderer(),
    node = root();
  const game = createIntegratedGame(node, {
    sessionId: 'combined',
    seed: 1,
    viewport,
    configuration: f.config,
    createRenderer: () => r,
  });
  await game.start();
  expect(game.read()?.phase).toBe('ready');
  expect(f.seek).toHaveBeenCalled();
  expect(node.querySelectorAll('canvas')).toHaveLength(1);
  const ready = game.read();
  if (!ready) throw new Error('Ready snapshot missing');
  const id = ready.runId;
  game.dispatch({ type: 'StartRequested', runId: id });
  const punch = Array.from(node.querySelectorAll('button')).find(
    (b) => b.textContent === 'パンチ',
  );
  if (!punch) throw new Error('Punch control missing');
  punch.click();
  game.advance(20);
  expect(game.read()?.actors[0]?.heat.amount).toBe(1);
  expect(game.read()?.actors[0]?.attack?.category).toBe('punch');
  expect(game.read()?.phase).toBe('running');
  game.dispatch({ type: 'PauseRequested', runId: id, reason: 'settings' });
  game.advance(1000);
  game.dispatch({ type: 'ResumeRequested', runId: id, reason: 'settings' });
  game.advance(20);
  expect(game.read()?.phase).toBe('running');
  expect(game.lastError()).toBeNull();
  await game.restart();
  expect(game.read()?.runId).not.toBe(id);
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.rigDispose).toHaveBeenCalledTimes(5);
  expect(node.querySelectorAll('canvas')).toHaveLength(1);
  game.dispose();
  expect(f.dispose).toHaveBeenCalledTimes(2);
  expect(node.querySelectorAll('canvas')).toHaveLength(0);
});
test('cancelled loading never publishes ready or leaks a late B pack', async () => {
  const f = fixture();
  let resolve!: (
    value: Awaited<ReturnType<typeof f.config.loadAssets>>,
  ) => void;
  const loaded = await f.config.loadAssets(
    { runId: 'unused' as never, seed: 1 },
    new AbortController().signal,
  );
  const config = {
    ...f.config,
    loadAssets: () =>
      new Promise<typeof loaded>((r) => {
        resolve = r;
      }),
  };
  const game = createIntegratedGame(root(), {
    sessionId: 'cancel',
    seed: 1,
    viewport,
    configuration: config,
    createRenderer: renderer,
  });
  const pending = game.start();
  game.stop();
  resolve(loaded);
  await pending;
  expect(game.read()).toBeNull();
  expect(game.hostState().phase).toBe('title');
  expect(f.dispose).toHaveBeenCalledTimes(1);
  game.dispose();
});

test('real C candidates from synthetic B shapes reduce Core HP and reach D HUD through one committed frame', async () => {
  const f = fixture(),
    layout = f.config.layout ?? createParisStreetLayout(),
    node = root();
  const game = createIntegratedGame(node, {
    sessionId: 'contact',
    seed: 1,
    viewport,
    createRenderer: renderer,
    configuration: {
      ...f.config,
      layout: {
        ...layout,
        actorSpawns: { ...layout.actorSpawns, blue: { x: 0, y: 0, z: 1.2 } },
      },
    },
  });
  await game.start();
  const state = game.read();
  if (!state) throw new Error('Missing ready state');
  game.dispatch({ type: 'StartRequested', runId: state.runId });
  game.advance(80);
  expect(game.read()?.actors[0]?.hp).toBe(410);
  expect(game.read()?.actors[1]?.heat.amount).toBe(1);
  expect(node.textContent).toContain('410');
  expect(game.lastError()).toBeNull();
  game.dispose();
});

function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x: number,
  y: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
}
test.each([false, true])(
  'held real D movement survives attack without extra pointer movement (pre-held=%s)',
  async (preHeld) => {
    const f = fixture(),
      node = root(),
      r = renderer();
    const game = createIntegratedGame(node, {
      sessionId: `held-${preHeld}`,
      seed: 1,
      viewport,
      stepMs: 20,
      configuration: f.config,
      createRenderer: () => r,
    });
    try {
      await game.start();
      const ready = game.read();
      if (!ready) throw new Error('Missing ready');
      game.dispatch({ type: 'StartRequested', runId: ready.runId });
      const swipe = node.querySelector('.nt-swipe');
      const punch = Array.from(node.querySelectorAll('button')).find(
        (b) => b.textContent === 'パンチ',
      );
      const white = f.rigs.get('white');
      if (!swipe || !punch || !white) throw new Error('Missing controls/rig');
      pointer(swipe, 'pointerdown', 1, 100, 200);
      pointer(document, 'pointermove', 1, 100, 136);
      if (preHeld) game.advance(20);
      const atAttack = white.getWorldPosition(new Vector3());
      punch.click();
      game.advance(80);
      expect(
        white.getWorldPosition(new Vector3()).distanceTo(atAttack),
      ).toBeCloseTo(0, 9);
      game.advance(80);
      expect(game.read()?.actors[0]?.attack).toBeNull();
      expect(
        white.getWorldPosition(new Vector3()).distanceTo(atAttack),
      ).toBeGreaterThan(0.1);
    } finally {
      game.dispose();
    }
  },
);
test.each([false, true])(
  'actual C lethal contacts retain D HUD and settled presentation through pause/expiry (airborne=%s)',
  async (airborne) => {
    const f = fixture(),
      node = root();
    const layout = f.config.layout ?? createParisStreetLayout();
    const whiteId = (id: ReturnType<typeof clipId>) => clipId(`white:${id}`);
    // Test-only asymmetric geometry: AI still uses real actions, but its shapes miss.
    // White's real swept shapes hit blue. No injected candidate or mutated HP is used.
    const game = createIntegratedGame(node, {
      sessionId: 'lethal-real-stack',
      seed: 1,
      viewport,
      stepMs: 20,
      createRenderer: renderer,
      configuration: {
        ...f.config,
        layout: {
          ...layout,
          actorSpawns: {
            ...layout.actorSpawns,
            blue: { x: 0, y: airborne ? 2.5 : 0, z: 1.2 },
          },
        },
        moves: {
          ...f.config.moves,
          white: {
            punches: f.config.moves.white.punches.map(whiteId),
            kicks: f.config.moves.white.kicks,
          },
        },
        async loadAssets(context, signal) {
          const pack = await f.config.loadAssets(context, signal);
          return {
            motions: [
              ...pack.motions.map((m) => ({
                ...m,
                shapes: m.shapes.map((s) => ({
                  ...s,
                  keys: s.keys.map((k) => ({
                    ...k,
                    volume: { ...k.volume, center: { x: 50, y: 1, z: 1 } },
                  })),
                })),
              })),
              ...pack.motions
                .filter((m) => m.definition.category === 'punch')
                .map((m) => ({
                  ...m,
                  // Deliberately broad test-only volume reaches the elevated victim.
                  shapes: airborne
                    ? m.shapes.map((shape) => ({
                        ...shape,
                        keys: shape.keys.map((key) => ({
                          ...key,
                          volume: {
                            kind: 'sphere' as const,
                            center: { x: 0, y: 2, z: 1 },
                            radiusM: 1.5,
                          },
                        })),
                      }))
                    : m.shapes,
                  definition: {
                    ...m.definition,
                    clipId: whiteId(m.definition.clipId),
                    // Test-only short-range strikes defeat the airborne victim before landing.
                    effectiveRangeM: airborne
                      ? 0.1
                      : m.definition.effectiveRangeM,
                  },
                })),
            ],
            animator: {
              ...pack.animator,
              clipDuration: (id) =>
                durationMs(
                  id === 'DefeatPunch' || id === 'DefeatKick' ? 500 : 100,
                ),
            },
          };
        },
      },
    });
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return new DOMRect(
          this.parentElement?.textContent?.startsWith('白 ') ? 0 : 200,
          20,
          100,
          10,
        );
      });
    try {
      await game.start();
      const ready = game.read();
      if (!ready) throw new Error('Missing ready');
      game.dispatch({ type: 'StartRequested', runId: ready.runId });
      const punch = [...node.querySelectorAll('button')].find(
        (b) => b.textContent === 'パンチ',
      );
      if (!punch) throw new Error('Missing punch');
      for (let i = 0; i < (airborne ? 4 : 6); i++) {
        punch.click();
        game.advance(120);
      }
      expect(game.lastError()).toBeNull();
      expect(game.read()?.actors.find((a) => a.color === 'blue')?.hp).toBe(0);
      expect(game.read()?.actors.find((a) => a.color === 'white')?.hp).toBe(
        500,
      );
      expect(game.read()?.currentOpponentId).toBeNull();
      expect(node.querySelectorAll('.nt-number')[1]?.textContent).toBe(
        '青 0 / 500',
      );
      expect(
        node
          .querySelectorAll('.nt-hp')[1]
          ?.querySelector('.nt-hp-red:not([hidden])'),
      ).not.toBeNull();
      const blue = f.rigs.get('blue'),
        visual = blue?.parent,
        physical = visual?.parent;
      if (!blue || !visual || !physical)
        throw new Error('Missing mounted victim');
      const frozenHeight = physical.position.y;
      if (airborne) expect(frozenHeight).toBeGreaterThan(0);
      const previousOffset = visual.position.y;
      game.advance(200);
      expect(physical.position.y).toBe(frozenHeight);
      expect(blue.position.y).toBe(0);
      if (airborne) expect(visual.position.y).toBeLessThan(previousOffset);
      const pausedOffset = visual.position.y;
      const particles = [
        ...node.querySelectorAll<HTMLElement>('.nt-particle:not([hidden])'),
      ];
      expect(particles.length).toBeGreaterThan(0);
      const frozen = game.read()?.clocks.presentationTimeMs;
      game.dispatch({
        type: 'PauseRequested',
        runId: ready.runId,
        reason: 'manual',
      });
      game.advance(500);
      expect(game.read()?.clocks.presentationTimeMs).toBe(frozen);
      expect(visual.position.y).toBe(pausedOffset);
      expect(physical.position.y).toBe(frozenHeight);
      expect(node.querySelectorAll('.nt-number')[1]?.textContent).toBe(
        '青 0 / 500',
      );
      game.dispatch({
        type: 'ResumeRequested',
        runId: ready.runId,
        reason: 'manual',
      });
      game.advance(190);
      const converging = [
        ...node.querySelectorAll<HTMLElement>('.nt-particle:not([hidden])'),
      ];
      expect(converging.length).toBeGreaterThan(0);
      for (const particle of converging) {
        const x = Number(
          particle.style.transform.match(/translate\(([-.\d]+)px/)?.[1],
        );
        expect(x).toBeGreaterThan(230);
        expect(x).toBeLessThan(270);
      }
      const snapshot = game.read(),
        stage = snapshot?.presentation;
      if (!snapshot || !stage || !('endsAt' in stage))
        throw new Error('Missing defeat deadline');
      game.advance(stage.endsAt - snapshot.clocks.presentationTimeMs);
      expect(
        [...node.querySelectorAll('.nt-number')].some((n) =>
          n.textContent?.startsWith('青 '),
        ),
      ).toBe(false);
      expect(node.querySelector('.nt-particle:not([hidden])')).toBeNull();
      expect(game.lastError()).toBeNull();
    } finally {
      game.dispose();
      rect.mockRestore();
    }
  },
);

test('missing selected catalog data cannot unlock readiness and retry creates a fresh complete run', async () => {
  const f = fixture(),
    node = root();
  let incomplete = true;
  const renders: ReturnType<typeof renderer>[] = [];
  const game = createIntegratedGame(node, {
    sessionId: 'catalog-retry',
    seed: 1,
    viewport,
    configuration: {
      ...f.config,
      async loadAssets(context, signal) {
        const pack = await f.config.loadAssets(context, signal);
        return {
          ...pack,
          motions: incomplete ? pack.motions.slice(1) : pack.motions,
        };
      },
    },
    createRenderer() {
      const r = renderer();
      renders.push(r);
      return r;
    },
  });
  try {
    await expect(game.start()).rejects.toThrow();
    expect(game.hostState().phase).toBe('error');
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(renders[0]?.dispose).toHaveBeenCalledOnce();
    expect(node.querySelectorAll('canvas')).toHaveLength(0);
    expect(f.rigDispose).not.toHaveBeenCalled();
    incomplete = false;
    await game.restart();
    expect(game.read()?.phase).toBe('ready');
    expect(node.querySelectorAll('canvas')).toHaveLength(1);
    expect(renders).toHaveLength(2);
  } finally {
    game.dispose();
  }
  expect(f.dispose).toHaveBeenCalledTimes(2);
  expect(f.rigDispose).toHaveBeenCalledTimes(5);
});
test.each(['release', 'pause'] as const)(
  'real held input cannot resume after %s during an attack',
  async (end) => {
    const f = fixture(),
      node = root(),
      game = createIntegratedGame(node, {
        sessionId: `held-stop-${end}`,
        seed: 1,
        viewport,
        stepMs: 20,
        configuration: f.config,
        createRenderer: renderer,
      });
    try {
      await game.start();
      const ready = game.read();
      if (!ready) throw new Error('Missing ready');
      game.dispatch({ type: 'StartRequested', runId: ready.runId });
      const swipe = node.querySelector('.nt-swipe'),
        punch = Array.from(node.querySelectorAll('button')).find(
          (b) => b.textContent === 'パンチ',
        ),
        white = f.rigs.get('white');
      if (!swipe || !punch || !white) throw new Error('Missing controls');
      pointer(swipe, 'pointerdown', 1, 100, 200);
      pointer(document, 'pointermove', 1, 100, 136);
      punch.click();
      game.advance(20);
      pointer(document, 'pointermove', 1, 164, 200);
      if (end === 'release') pointer(document, 'pointerup', 1, 164, 200);
      else {
        game.dispatch({
          type: 'PauseRequested',
          runId: ready.runId,
          reason: 'settings',
        });
        game.dispatch({
          type: 'ResumeRequested',
          runId: ready.runId,
          reason: 'settings',
        });
      }
      game.advance(200);
      expect(white.getWorldPosition(new Vector3()).length()).toBeCloseTo(0, 9);
    } finally {
      game.dispose();
    }
  },
);
test('retained and changed direction does not double-add free movement to authored root, then resumes after attack', async () => {
  const f = fixture(),
    node = root();
  const game = createIntegratedGame(node, {
    sessionId: 'authored-held',
    seed: 1,
    viewport,
    stepMs: 20,
    configuration: {
      ...f.config,
      async loadAssets(context, signal) {
        const pack = await f.config.loadAssets(context, signal);
        return {
          ...pack,
          motions: pack.motions.map((m) => ({
            ...m,
            definition: {
              ...m.definition,
              rootCurve: m.definition.rootCurve.map((k) => ({
                ...k,
                position: { x: 0, y: 0, z: k.atMs / 100 },
              })),
            },
            ownership: [
              {
                atMs: durationMs(0),
                horizontalOwner: 'authored-root',
                verticalOwner: 'spatial-jump',
              },
            ],
          })),
        };
      },
    },
    createRenderer: renderer,
  });
  try {
    await game.start();
    const ready = game.read();
    if (!ready) throw new Error('Missing ready');
    game.dispatch({ type: 'StartRequested', runId: ready.runId });
    const swipe = node.querySelector('.nt-swipe'),
      punch = Array.from(node.querySelectorAll('button')).find(
        (b) => b.textContent === 'パンチ',
      ),
      white = f.rigs.get('white');
    if (!swipe || !punch || !white) throw new Error('Missing controls');
    pointer(swipe, 'pointerdown', 1, 100, 200);
    pointer(document, 'pointermove', 1, 100, 136);
    punch.click();
    game.advance(40);
    pointer(document, 'pointermove', 1, 164, 200);
    game.advance(40);
    const during = white.getWorldPosition(new Vector3());
    expect(during.x).toBeCloseTo(0, 8);
    expect(during.z).toBeCloseTo(0.8, 8);
    game.advance(80);
    const after = white.getWorldPosition(new Vector3());
    expect(Math.abs(after.x)).toBeGreaterThan(0.1);
    expect(after.z).toBeCloseTo(1, 8);
  } finally {
    game.dispose();
  }
});

test('invalid controller options cannot leave an unowned D shell in caller DOM', () => {
  const node = root(),
    existing = document.createElement('span');
  node.append(existing);
  expect(() =>
    createIntegratedGame(node, {
      sessionId: 'invalid',
      seed: Number.NaN,
      createRenderer: renderer,
    }),
  ).toThrow('Seed');
  expect(node.children).toHaveLength(1);
  expect(node.firstChild).toBe(existing);
});

test.each([
  'idle',
  'walk',
  'run',
  'jump',
  'punch:0',
  'kick:18',
  'DefeatPunch',
  'DefeatKick',
])(
  'missing visual %s rejects before rigs/readiness and a complete retry succeeds',
  async (missing) => {
    const f = fixture(),
      node = root();
    let incomplete = true;
    const game = createIntegratedGame(node, {
      sessionId: `missing-visual-${missing}`,
      seed: 1,
      viewport,
      createRenderer: renderer,
      configuration: {
        ...f.config,
        async loadAssets(context, signal) {
          const pack = await f.config.loadAssets(context, signal);
          return {
            ...pack,
            animator: {
              ...pack.animator,
              clipDuration(id) {
                return incomplete && id === missing
                  ? undefined
                  : pack.animator.clipDuration(id);
              },
            },
          };
        },
      },
    });
    try {
      await expect(game.start()).rejects.toThrow();
      expect(game.hostState().phase).toBe('error');
      expect(f.rigs.size).toBe(0);
      expect(f.rigDispose).not.toHaveBeenCalled();
      expect(f.dispose).toHaveBeenCalledOnce();
      expect(node.querySelectorAll('canvas')).toHaveLength(0);
      incomplete = false;
      await game.restart();
      expect(game.read()?.phase).toBe('ready');
      expect(f.rigs.size).toBe(5);
    } finally {
      game.dispose();
    }
    expect(f.dispose).toHaveBeenCalledTimes(2);
    expect(f.rigDispose).toHaveBeenCalledTimes(5);
  },
);
test.each([
  ['walk', 0],
  ['walk', -1],
  ['walk', Number.NaN],
  ['walk', Number.POSITIVE_INFINITY],
  ['DefeatPunch', 499],
  ['DefeatPunch', 501],
  ['DefeatKick', 499],
  ['DefeatKick', 501],
  ['punch:0', 50],
  ['kick:18', 101],
] as const)(
  'invalid visual duration %s=%s cannot publish readiness',
  async (clip, duration) => {
    const f = fixture();
    const game = createIntegratedGame(root(), {
      sessionId: `invalid-visual-${clip}-${duration}`,
      seed: 1,
      viewport,
      createRenderer: renderer,
      configuration: {
        ...f.config,
        async loadAssets(context, signal) {
          const pack = await f.config.loadAssets(context, signal);
          return {
            ...pack,
            animator: {
              ...pack.animator,
              clipDuration(id) {
                return id === clip
                  ? (duration as ReturnType<typeof durationMs>)
                  : pack.animator.clipDuration(id);
              },
            },
          };
        },
      },
    });
    try {
      await expect(game.start()).rejects.toThrow();
      expect(game.hostState().phase).toBe('error');
      expect(f.rigs.size).toBe(0);
      expect(f.dispose).toHaveBeenCalledOnce();
    } finally {
      game.dispose();
    }
    expect(f.dispose).toHaveBeenCalledOnce();
  },
);

test.each([
  'nested arrays',
  'enemy nested array',
  'top-level replacement',
] as const)(
  'async readiness uses Core move snapshot despite caller %s mutation',
  async (mutation) => {
    const f = fixture();
    const moves = Object.fromEntries(
      Object.entries(f.config.moves).map(([color, set]) => [
        color,
        {
          punches: [...set.punches],
          kicks: [...set.kicks],
        },
      ]),
    ) as Record<
      ActorColor,
      {
        punches: ReturnType<typeof clipId>[];
        kicks: ReturnType<typeof clipId>[];
      }
    >;
    const pack = await f.config.loadAssets(
      { runId: 'fixture' as never, seed: 1 },
      new AbortController().signal,
    );
    const enemyClip = clipId('enemy-only:punch');
    const source = pack.motions[0];
    if (!source) throw new Error('Missing fixture motion');
    if (mutation === 'enemy nested array') moves.blue.punches[0] = enemyClip;
    let resolve!: (value: typeof pack) => void;
    const configuration = {
      ...f.config,
      moves,
      loadAssets: () =>
        new Promise<typeof pack>((r) => {
          resolve = r;
        }),
    };
    const game = createIntegratedGame(root(), {
      sessionId: `mutation-${mutation}`,
      seed: 1,
      viewport,
      createRenderer: renderer,
      configuration,
    });
    try {
      const pending = game.start();
      const rejected = expect(pending).rejects.toThrow();
      // Caller objects remain writable: composition must copy, never freeze/mutate its caller.
      expect(Object.isFrozen(moves)).toBe(false);
      expect(Object.isFrozen(moves.blue.punches)).toBe(false);
      if (mutation === 'enemy nested array')
        moves.blue.punches.splice(0, 1, clipId('punch:0'));
      else if (mutation === 'nested arrays')
        for (const set of Object.values(moves)) set.punches.splice(0);
      else
        configuration.moves = Object.fromEntries(
          Object.entries(moves).map(([color, set]) => [
            color,
            { ...set, punches: [] as ReturnType<typeof clipId>[] },
          ]),
        ) as typeof moves;
      resolve({
        ...pack,
        motions: [
          ...pack.motions,
          {
            ...source,
            definition: { ...source.definition, clipId: enemyClip },
          },
        ],
        animator: {
          ...pack.animator,
          clipDuration(id) {
            return (
              mutation === 'enemy nested array'
                ? id === enemyClip
                : id.startsWith('punch:')
            )
              ? undefined
              : pack.animator.clipDuration(id);
          },
        },
      });
      await rejected;
      expect(game.hostState().phase).toBe('error');
      expect(f.rigs.size).toBe(0);
      expect(f.dispose).toHaveBeenCalledOnce();
    } finally {
      game.dispose();
    }
    expect(f.dispose).toHaveBeenCalledOnce();
  },
);

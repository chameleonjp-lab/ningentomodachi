// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createBrowserViewport } from '../../src/app/browserViewport';
import { Vector3 } from 'three';
import { createSceneAdapter } from '../../src/scene';
import { createParisBattleLayout } from '../../src/world/street-layout';
import { run, state, viewport } from '../world/fixtures';
import { mountApplication } from '../../src/app/mountApplication';
import { createInterface } from '../../src/ui';
import {
  run as uiRun,
  snapshot as uiSnapshot,
  viewport as uiViewport,
} from '../ui/fixtures/core';
import type { GameCommand } from '../../src/contracts';
test('browser viewport uses CSS root bounds, updates listeners and releases observer/event resources', () => {
  const root = document.createElement('div');
  document.body.append(root);
  root.getBoundingClientRect = () => ({
    x: 20,
    y: 30,
    left: 20,
    top: 30,
    right: 660,
    bottom: 510,
    width: 640,
    height: 480,
    toJSON() {
      return {};
    },
  });
  const source = createBrowserViewport(root, window);
  expect(source.read()).toMatchObject({
    widthCssPx: 640,
    heightCssPx: 480,
    offsetLeftCssPx: 20,
    offsetTopCssPx: 30,
  });
  const listener = vi.fn();
  const unsubscribe = source.subscribe(listener);
  window.dispatchEvent(new Event('resize'));
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  window.dispatchEvent(new Event('resize'));
  expect(listener).toHaveBeenCalledTimes(1);
  source.dispose();
  expect(root.children).toHaveLength(0);
});
test('mounted entry visibly gates missing assets, keeps lifecycle pump and leaves caller DOM intact on disposal', async () => {
  const root = document.createElement('main'),
    existing = document.createElement('span');
  existing.textContent = 'caller-owned';
  root.append(existing);
  document.body.append(root);
  let frame: FrameRequestCallback | undefined;
  const cancel = vi.fn();
  const host = {
    requestFrame: (f: FrameRequestCallback) => {
      frame = f;
      return 1;
    },
    cancelFrame: cancel,
    subscribe: () => () => {},
  };
  const app = mountApplication(root, {
    sessionId: 'entry',
    seed: 1,
    browserHost: host,
  });
  await app.ready;
  expect(root.textContent).toContain('未承認');
  expect(root.querySelector('.nt-interface')).not.toBeNull();
  expect(app.game.hostState().phase).toBe('title');
  expect(frame).toBeDefined();
  await expect(app.game.start()).rejects.toThrow();
  expect(app.game.hostState().phase).toBe('error');
  app.dispose();
  expect(cancel).toHaveBeenCalled();
  expect(root.children).toHaveLength(1);
  expect(root.firstChild).toBe(existing);
});

test('failure to start browser scheduling cleans owned DOM and game resources', () => {
  const root = document.createElement('main');
  document.body.append(root);
  const unsubscribe = vi.fn();
  expect(() =>
    mountApplication(root, {
      sessionId: 'failed-host',
      seed: 1,
      browserHost: {
        requestFrame() {
          throw new Error('RAF unavailable');
        },
        cancelFrame() {},
        subscribe: () => unsubscribe,
      },
    }),
  ).toThrow('RAF unavailable');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(root.children).toHaveLength(0);
});

test.each([false, true])(
  'viewport setup/cleanup failure preserves original error and removes only owned DOM (observe fails=%s)',
  (observeFails) => {
    const root = document.createElement('main'),
      existing = document.createElement('span');
    root.append(existing);
    document.body.append(root);
    const disconnected = vi.fn(() => {
      throw new Error('observer cleanup failed');
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          if (observeFails) throw new Error('observer setup failed');
        }
        disconnect = disconnected;
      },
    );
    let thrown: unknown;
    try {
      try {
        mountApplication(root, {
          sessionId: 'cleanup-failure',
          seed: 1,
          browserHost: {
            requestFrame() {
              throw new Error('RAF unavailable');
            },
            cancelFrame() {},
            subscribe: () => () => {},
          },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      if (!(thrown instanceof AggregateError))
        throw new Error('Missing aggregate');
      expect(thrown.errors[0]).toMatchObject({
        message: observeFails ? 'observer setup failed' : 'RAF unavailable',
      });
      expect(disconnected).toHaveBeenCalledOnce();
      expect(root.children).toHaveLength(1);
      expect(root.firstChild).toBe(existing);
      window.dispatchEvent(new Event('resize'));
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test('DPR changes backing pixels not canvas CSS dimensions', async () => {
  const root = document.createElement('main');
  document.body.append(root);
  const app = mountApplication(root, {
    sessionId: 'canvas-css',
    seed: 1,
    browserHost: {
      requestFrame: () => 1,
      cancelFrame() {},
      subscribe: () => () => {},
    },
  });
  await app.ready;
  const surface = root.querySelector<HTMLElement>('[data-game-surface]');
  if (!surface) throw new Error('Missing application surface');
  const canvas = document.createElement('canvas');
  let ratio = 1;
  const drawSizes: number[][] = [],
    projections: number[] = [];
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      layout: createParisBattleLayout(),
      root: surface,
      onInterruption() {},
      createRenderer: () => ({
        domElement: canvas,
        render(_scene, camera) {
          camera.updateMatrixWorld();
          projections.push(new Vector3(0.2, 2.1, 0.6).project(camera).x);
        },
        dispose() {},
        setPixelRatio(value) {
          ratio = value;
        },
        setSize(width, height, updateStyle) {
          drawSizes.push([width, height]);
          canvas.width = width * ratio;
          canvas.height = height * ratio;
          if (updateStyle !== false) {
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
          }
        },
      }),
    },
  );
  const snapshot = state(),
    spatial = scene.commit({ snapshot, events: [] }, viewport);
  for (const devicePixelRatio of [1, 2, 3]) {
    const vp = {
      ...viewport,
      widthCssPx: 390,
      heightCssPx: 844,
      devicePixelRatio,
    };
    scene.render({ snapshot, spatial, events: [], viewport: vp });
    expect(getComputedStyle(canvas).width).toBe('100%');
    expect(getComputedStyle(canvas).height).toBe('100%');
    expect(canvas.width).toBe(390 * Math.min(devicePixelRatio, 2));
    expect(canvas.height).toBe(844 * Math.min(devicePixelRatio, 2));
  }
  expect(drawSizes).toEqual([
    [390, 844],
    [390, 844],
    [390, 844],
  ]);
  expect(projections).toHaveLength(3);
  const [first, ...rest] = projections;
  if (first === undefined) throw new Error('Missing DPR projection');
  for (const projected of rest) expect(projected).toBeCloseTo(first, 10);
  scene.dispose();
  app.dispose();
  root.remove();
});

test('80px border-box attack controls preserve native jump activation and independent swipe ownership', () => {
  const root = document.createElement('main');
  document.body.append(root);
  const factories = createInterface(root, {
    storage: { getItem: () => null, setItem() {} },
  });
  const reader = { read: () => uiViewport, subscribe: () => () => {} };
  const host = factories.host(reader);
  host.render({
    revision: 1,
    phase: 'playing',
    runId: uiRun,
    game: uiSnapshot(),
    error: null,
    viewport: uiViewport,
  });
  const ended: string[] = [];
  const input = factories.input({
    runId: uiRun,
    seed: 1,
    viewport: reader,
    readSnapshot: () => uiSnapshot(),
    movement: {
      begin: (sessionId) => ({
        runId: uiRun,
        sessionId,
        revision: 1,
        right: { x: 1, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 1 },
      }),
      end: (id) => {
        ended.push(id);
      },
      releaseAll() {},
    },
  });
  const commands: GameCommand[] = [];
  input.subscribe((command) => commands.push(command));
  input.setGate({ runId: uiRun, enabled: true });
  const [punch, kick, jump] = [
    ...root.querySelectorAll<HTMLButtonElement>('.nt-control'),
  ];
  const move = root.querySelector<HTMLElement>('.nt-swipe');
  if (!punch || !kick || !jump || !move) throw Error('Missing controls');
  const dispatch = (
    node: HTMLElement,
    type: string,
    id: number,
    x: number,
    y: number,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: id });
    node.dispatchEvent(event);
  };
  try {
    expect([punch, kick].map((node) => node.style.width)).toEqual([
      '80px',
      '80px',
    ]);
    for (const node of [punch, kick, jump]) {
      expect(getComputedStyle(node).boxSizing).toBe('border-box');
      expect(node.type).toBe('button');
      expect(node.disabled).toBe(false);
    }
    expect(jump.style.width).toBe('48px');
    dispatch(move, 'pointerdown', 11, 50, 400);
    dispatch(punch, 'pointerdown', 12, 340, 650);
    dispatch(punch, 'pointermove', 11, 50, 432);
    dispatch(move, 'pointermove', 12, 50, 350);
    punch.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(
      commands.filter((command) => command.type === 'AttackRequested'),
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command.type === 'CrouchRequested'),
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command.type === 'JumpRequested'),
    ).toHaveLength(0);
    dispatch(document.body, 'pointerup', 12, 340, 650);
    expect(ended).toEqual([]);
    dispatch(document.body, 'pointerup', 11, 50, 432);
    expect(ended).toHaveLength(1);
    jump.focus();
    jump.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    expect(
      commands.filter((command) => command.type === 'JumpRequested'),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(jump);
    const repeated = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    jump.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(true);
    expect(
      commands.filter((command) => command.type === 'JumpRequested'),
    ).toHaveLength(1);
  } finally {
    input.dispose();
    host.dispose();
    root.remove();
  }
});

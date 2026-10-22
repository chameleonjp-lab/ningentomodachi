// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createBrowserViewport } from '../../src/app/browserViewport';
import { mountApplication } from '../../src/app/mountApplication';
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

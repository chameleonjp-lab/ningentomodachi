import { expect, test, vi } from 'vitest';
import {
  bootstrap,
  type BrowserHost,
  type BrowserLifecycleEvent,
} from '../../src/app/bootstrap';
import { createGame } from '../../src/app/createGame';
import type { ViewportMetrics } from '../../src/contracts';
import { createFixturePorts } from '../core/fixtures/ports';
function fixture() {
  const game = createGame(createFixturePorts().factories, {
    sessionId: 'setup',
    seed: 1,
  });
  const metrics = game.viewport.read();
  const update = vi.spyOn(game, 'updateViewport'),
    dispatch = vi.spyOn(game, 'dispatch'),
    dispose = vi.spyOn(game, 'dispose');
  let lateViewport: ((metrics: ViewportMetrics) => void) | undefined,
    lateLifecycle: ((event: BrowserLifecycleEvent) => void) | undefined,
    lateFrame: ((now: number) => void) | undefined;
  const releaseViewport = vi.fn(),
    releaseLifecycle = vi.fn();
  const host: BrowserHost = {
    viewport: {
      read: () => metrics,
      subscribe(listener) {
        lateViewport = listener;
        return releaseViewport;
      },
    },
    subscribe(listener) {
      lateLifecycle = listener;
      return releaseLifecycle;
    },
    requestFrame(listener) {
      lateFrame = listener;
      throw new Error('request failed');
    },
    cancelFrame: vi.fn(),
  };
  return {
    game,
    host,
    update,
    dispatch,
    dispose,
    releaseViewport,
    releaseLifecycle,
    late() {
      lateViewport?.(metrics);
      lateLifecycle?.('hidden');
      lateFrame?.(10000);
    },
  };
}
test('initial scheduler failure releases every acquired resource and ignores retained callbacks', () => {
  const f = fixture();
  expect(() => bootstrap(f.game, f.host)).toThrow('request failed');
  expect(f.releaseViewport).toHaveBeenCalledOnce();
  expect(f.releaseLifecycle).toHaveBeenCalledOnce();
  expect(f.dispose).toHaveBeenCalledOnce();
  const updates = f.update.mock.calls.length;
  f.late();
  expect(f.update).toHaveBeenCalledTimes(updates);
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledOnce();
});
test.each([
  'viewport-read',
  'viewport-subscribe',
  'lifecycle-subscribe',
] as const)('rolls back %s setup failure', (stage) => {
  const f = fixture();
  const viewport = f.host.viewport;
  if (!viewport) throw new Error('Missing fixture viewport');
  const error = new Error(stage);
  const fail = () => {
    throw error;
  };
  const host: BrowserHost = {
    ...f.host,
    ...(stage === 'lifecycle-subscribe' ? { subscribe: fail } : {}),
    viewport: {
      read: stage === 'viewport-read' ? fail : () => f.game.viewport.read(),
      subscribe: stage === 'viewport-subscribe' ? fail : viewport.subscribe,
    },
  };
  expect(() => bootstrap(f.game, host)).toThrow(error);
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.releaseViewport).toHaveBeenCalledTimes(
    stage === 'lifecycle-subscribe' ? 1 : 0,
  );
  expect(f.releaseLifecycle).not.toHaveBeenCalled();
  const updates = f.update.mock.calls.length;
  f.late();
  expect(f.update).toHaveBeenCalledTimes(updates);
});
test('cleanup exceptions do not mask original setup failure or skip later acquired cleanups', () => {
  const f = fixture();
  const cleanupError = new Error('release failed');
  f.releaseLifecycle.mockImplementation(() => {
    throw cleanupError;
  });
  let thrown: unknown;
  try {
    bootstrap(f.game, f.host);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AggregateError);
  if (!(thrown instanceof AggregateError)) throw new Error('Missing aggregate');
  expect(thrown.errors[0]).toMatchObject({ message: 'request failed' });
  expect(thrown.errors[1]).toBeInstanceOf(AggregateError);
  expect((thrown.errors[1] as AggregateError).errors).toContain(cleanupError);
  expect(f.releaseViewport).toHaveBeenCalledOnce();
  expect(f.dispose).toHaveBeenCalledOnce();
  f.late();
  expect(f.dispose).toHaveBeenCalledOnce();
});

import type { PauseReason, Unsubscribe, ViewportMetrics } from '../contracts';
import type { GameController } from './createGame';
export type BrowserLifecycleEvent = 'hidden' | 'visible' | 'blur';
export interface ViewportSource {
  read(): ViewportMetrics;
  subscribe(listener: (metrics: ViewportMetrics) => void): Unsubscribe;
}
export interface BrowserHost {
  readonly viewport?: ViewportSource;
  requestFrame(listener: (nowMs: number) => void): number;
  cancelFrame(id: number): void;
  subscribe(listener: (event: BrowserLifecycleEvent) => void): Unsubscribe;
}
/** Browser services are injected so bootstrap and interruption behavior remain headless-testable. */
export function bootstrap(
  game: GameController,
  host: BrowserHost,
  onError: (error: unknown) => void = () => {},
  options: { readonly autoPrepare?: boolean } = {},
) {
  let stopped = false;
  let frameId: number | null = null;
  let previous: number | null = null;
  let hidden = false;
  let previousRun: string | null = null;
  let previousStartup: number | null = null;
  let startupRequest = 0;
  function startupPause(reason: PauseReason, paused: boolean) {
    const startup = game.hostState().startup;
    if (!startup) return;
    game.request({
      type: paused ? 'StartupPauseRequested' : 'StartupResumeRequested',
      requestId: `browser-startup:${++startupRequest}`,
      startupGeneration: startup.generation,
      reason,
    });
  }
  function pauseHiddenStartup() {
    startupPause('background', true);
    startupPause('interruption', true);
  }
  let previousEpoch = game.timingEpoch();
  let unsubscribeViewport: Unsubscribe = () => {};
  let unsubscribe: Unsubscribe = () => {};
  try {
    if (host.viewport) game.updateViewport(host.viewport.read());
    unsubscribeViewport =
      host.viewport?.subscribe((metrics) => {
        if (stopped) return;
        previous = null;
        game.updateViewport(metrics);
      }) ?? (() => {});
    unsubscribe = host.subscribe((event) => {
      if (stopped) return;
      previous = null;
      const wasHidden = hidden;
      if (event === 'hidden') hidden = true;
      if (event === 'visible') hidden = false;
      if (game.hostState().startup) {
        if (event === 'hidden') pauseHiddenStartup();
        else if (event === 'visible') {
          if (wasHidden) startupPause('interruption', true);
          startupPause('background', false);
        } else startupPause('interruption', true);
        return;
      }
      const snapshot = game.read();
      if (!snapshot) return;
      if (event === 'hidden')
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
      else if (event === 'visible') {
        // A retry may have created this run while hidden, without receiving the original event.
        if (wasHidden)
          game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
        game.dispatch({ type: 'Foregrounded', runId: snapshot.runId });
      } else
        game.dispatch({
          type: 'PauseRequested',
          runId: snapshot.runId,
          reason: 'interruption',
        });
    });
  } catch (error) {
    failSetup(error);
  }
  function failSetup(error: unknown): never {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Browser setup and cleanup failed',
      );
    }
    throw error;
  }

  function dispose() {
    if (stopped) return;
    stopped = true;
    const errors: unknown[] = [];
    const actions = [
      () => {
        if (frameId !== null) host.cancelFrame(frameId);
      },
      unsubscribe,
      unsubscribeViewport,
      () => game.dispose(),
    ];
    for (const action of actions) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Browser binding cleanup failed');
  }
  function frame(nowMs: number) {
    frameId = null;
    if (stopped) return;
    if (!Number.isFinite(nowMs)) {
      previous = null;
      onError(new RangeError('Frame timestamp must be finite'));
      if (!stopped) frameId = host.requestFrame(frame);
      return;
    }
    // Keep a non-simulating pump during errors so a successful game.restart can recover.
    const startup = game.hostState().startup;
    if ((startup?.generation ?? null) !== previousStartup) {
      previousStartup = startup?.generation ?? null;
      previous = null;
      if (startup && hidden) pauseHiddenStartup();
    }
    const snapshot = game.read();
    const epoch = game.timingEpoch();
    if (epoch !== previousEpoch) {
      previous = null;
      previousEpoch = epoch;
    }
    if (snapshot?.runId !== previousRun) {
      if (!startup) previous = null;
      previousRun = snapshot?.runId ?? null;
      if (hidden && snapshot && !startup)
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
    }
    if (
      !hidden &&
      (startup ||
        (snapshot && !['error', 'loading', 'stopped'].includes(snapshot.phase)))
    ) {
      if (previous !== null) {
        try {
          game.advance(Math.max(0, nowMs - previous));
        } catch (error) {
          previous = null;
          onError(error);
          if (!stopped) frameId = host.requestFrame(frame);
          return;
        }
      }
      previous = nowMs;
      previousEpoch = game.timingEpoch();
    } else {
      previous = null;
    }
    if (!stopped) frameId = host.requestFrame(frame);
  }
  // The shell/RAF/listeners survive an initial load failure and title/cancel transitions.
  try {
    frameId = host.requestFrame(frame);
  } catch (error) {
    failSetup(error);
  }

  const ready = (
    options.autoPrepare === false ? Promise.resolve() : game.start()
  )
    .then(() => {
      const snapshot = game.read();
      if (!stopped && hidden && game.hostState().startup) pauseHiddenStartup();
      else if (!stopped && hidden && snapshot)
        game.dispatch({ type: 'Backgrounded', runId: snapshot.runId });
    })
    .catch((error: unknown) => {
      onError(error);
      throw error;
    });
  return { ready, dispose };
}
export function createBrowserHost(
  browserWindow: Window,
  browserDocument: Document,
  viewport?: ViewportSource,
): BrowserHost {
  return {
    ...(viewport ? { viewport } : {}),
    requestFrame: (listener) => browserWindow.requestAnimationFrame(listener),
    cancelFrame: (id) => browserWindow.cancelAnimationFrame(id),
    subscribe: (listener) => {
      const visibility = () =>
        listener(browserDocument.hidden ? 'hidden' : 'visible');
      const blur = () => listener('blur');
      const pagehide = () => listener('hidden');
      const resources: readonly [EventTarget, string, EventListener][] = [
        [browserDocument, 'visibilitychange', visibility],
        [browserWindow, 'blur', blur],
        [browserWindow, 'pagehide', pagehide],
        [browserWindow, 'pageshow', visibility],
      ];
      const acquired: (typeof resources)[number][] = [];
      const cleanup = () => {
        const errors: unknown[] = [];
        for (const [target, event, listener] of acquired.splice(0)) {
          try {
            target.removeEventListener(event, listener);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length)
          throw new AggregateError(errors, 'Browser listeners cleanup failed');
      };
      try {
        for (const resource of resources) {
          const [target, event, listener] = resource;
          target.addEventListener(event, listener);
          acquired.push(resource);
        }
        visibility();
      } catch (error) {
        try {
          cleanup();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Browser listener setup and cleanup failed',
          );
        }
        throw error;
      }
      return cleanup;
    },
  };
}

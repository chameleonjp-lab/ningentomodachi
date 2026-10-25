import { bootstrap, createBrowserHost, type BrowserHost } from './bootstrap';
import { createBrowserViewport } from './browserViewport';
import {
  createIntegratedGame,
  type IntegratedGameOptions,
} from './integratedGame';
function cleanupOwnedResources(
  actions: readonly (() => void)[],
  errors: unknown[] = [],
) {
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, 'Application setup or cleanup failed');
}
export function mountApplication(
  root: HTMLElement,
  options: IntegratedGameOptions & { readonly browserHost?: BrowserHost },
) {
  const browser = root.ownerDocument.defaultView;
  if (!browser) throw new Error('A browser document is required');
  const surface = root.ownerDocument.createElement('div');
  surface.dataset.gameSurface = '';
  surface.setAttribute('aria-label', 'ニンゲントモダチ');
  const style = root.ownerDocument.createElement('style');
  style.textContent =
    '[data-game-surface]{position:relative;width:100%;height:100vh;height:100dvh;overflow:hidden;background:#101a30}[data-game-surface]>canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0}[data-game-surface]>.nt-interface{z-index:1}.nt-asset-gate{position:absolute;z-index:2;top:8px;left:8px;right:8px;margin:0;padding:8px;color:#fff;background:#101a30;font:14px/1.4 system-ui;pointer-events:none}';
  surface.append(style);
  if (!options.configuration) {
    const notice = root.ownerDocument.createElement('p');
    notice.className = 'nt-asset-gate';
    notice.setAttribute('role', 'status');
    notice.textContent =
      '実モーションの当たり判定と死亡表現は未承認です。ゲーム開始は利用できません。';
    surface.append(notice);
  }
  root.append(surface);
  let viewport: ReturnType<typeof createBrowserViewport>;
  try {
    viewport = createBrowserViewport(surface, browser);
  } catch (error) {
    cleanupOwnedResources([() => surface.remove()], [error]);
    throw error;
  }
  let game: ReturnType<typeof createIntegratedGame>;
  try {
    game = createIntegratedGame(surface, {
      ...options,
      viewport: viewport.read(),
    });
  } catch (error) {
    cleanupOwnedResources(
      [() => viewport.dispose(), () => surface.remove()],
      [error],
    );
    throw error;
  }
  const host =
    options.browserHost ??
    createBrowserHost(browser, root.ownerDocument, viewport);
  let binding: ReturnType<typeof bootstrap>;
  try {
    binding = bootstrap(game, host, options.onError, { autoPrepare: false });
  } catch (error) {
    cleanupOwnedResources(
      [() => game.dispose(), () => viewport.dispose(), () => surface.remove()],
      [error],
    );
    throw error;
  }
  let disposed = false;
  return {
    game,
    ready: binding.ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupOwnedResources([
        () => binding.dispose(),
        () => viewport.dispose(),
        () => surface.remove(),
      ]);
    },
  };
}

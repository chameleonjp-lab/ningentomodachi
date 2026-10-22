import type {
  InputModuleContext,
  InputPort,
  UiModuleContext,
} from '../contracts';
import { bindPointerControls, createPointerInput } from '../input';
import { createHud } from './hud';
import { createShell } from './shell';
import type { SettingsStorage } from './settings';
export type { ControlSettings, SettingsStorage } from './settings';
/** Compose these three factories into A's ModuleFactories. The root is a positioned render root.
 * Host is app-lifetime; HUD/input are run-lifetime. No renderer, Core or simulation is created here. */
export function createInterface(
  root: HTMLElement,
  options: { readonly storage?: SettingsStorage } = {},
) {
  let storage = options.storage;
  if (!storage) {
    try {
      storage = root.ownerDocument.defaultView?.localStorage;
    } catch {
      /* Private browsing may deny storage access. */
    }
  }
  const shell = createShell(root, storage);
  return {
    host: shell.host,
    ui: (context: UiModuleContext) => createHud(context, shell),
    input: (context: InputModuleContext): InputPort => {
      const input = createPointerInput(context);
      const binding = bindPointerControls(
        input,
        shell.controls,
        root.ownerDocument,
      );
      const unsubscribe = context.viewport.subscribe(() =>
        input.cancel('viewport-change'),
      );
      let disposed = false;
      return {
        subscribe: (listener) => input.subscribe(listener),
        setGate: (gate) => {
          if (gate.runId !== context.runId) return;
          if (!gate.enabled) binding.releaseAll();
          input.setGate(gate);
        },
        releaseAll: () => {
          binding.releaseAll();
          input.releaseAll();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribe();
          binding.dispose();
          input.dispose();
        },
      };
    },
  };
}

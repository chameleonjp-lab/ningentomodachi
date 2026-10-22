import type {
  CoreOutput,
  GameCommand,
  ModuleFactories,
} from '../../../src/contracts';
import type { FixtureRenderNode } from './renderHost';
import { createFixtureCatalog } from './catalog';
import { createFixtureSpatial } from './spatial';
export function createFixturePorts() {
  const trace: string[] = [];
  const outputs: CoreOutput[] = [];
  const listeners = new Set<(command: GameCommand) => void>();
  const factories: ModuleFactories<FixtureRenderNode> = {
    catalog: () => createFixtureCatalog(trace),
    spatial: (context) => createFixtureSpatial(trace, context),
    animation: () => ({
      render: () => {
        trace.push('animation.render');
      },
      dispose: () => {
        trace.push('animation.dispose');
      },
    }),
    ui: () => ({
      render: (output) => {
        outputs.push(output);
        trace.push('ui.render');
      },
      dispose: () => {
        trace.push('ui.dispose');
      },
    }),
    input: () => ({
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          trace.push('input.unsubscribe');
        };
      },
      setGate: () => {},
      releaseAll: () => {
        trace.push('input.release');
      },
      dispose: () => {
        trace.push('input.dispose');
      },
    }),
  };
  return {
    factories,
    trace,
    outputs,
    listeners,
    emit: (command: GameCommand) => {
      for (const listener of listeners) listener(command);
    },
  };
}

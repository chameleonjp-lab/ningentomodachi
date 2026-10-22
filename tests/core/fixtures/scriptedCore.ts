import {
  presentationTimeMs,
  type CoreOutput,
  type CorePort,
  type DomainEvent,
  type GameSnapshot,
  type RunContext,
} from '../../../src/contracts';
import { createFoundationCore } from '../../../src/core/foundation';
/** Test-only scripted authority, not a combat/score/world implementation. */
export function createScriptedCore(context: RunContext) {
  const base = createFoundationCore(context);
  let overrides: Partial<GameSnapshot> = {};
  let events: readonly DomainEvent[] = [];
  let revision = 0;
  const read = (): GameSnapshot =>
    Object.freeze({
      ...base.read(),
      ...overrides,
      revision: base.read().revision + revision,
    });
  const output = (original: CoreOutput): CoreOutput => {
    const result = Object.freeze({
      snapshot: read(),
      events: Object.freeze([...original.events, ...events]),
    });
    events = [];
    return result;
  };
  const core: CorePort = {
    ...base,
    read,
    beginStep: (step) => {
      const request = base.beginStep(step);
      return Object.freeze({ ...request, snapshot: read() });
    },
    drain: () => output(base.drain()),
    completeStep: (result) => output(base.completeStep(result)),
    present: (elapsed) => {
      if (read().phase === 'terminal') {
        const current = read();
        if (current.pauseReasons.length === 0 && elapsed > 0) {
          overrides = {
            ...overrides,
            clocks: Object.freeze({
              ...current.clocks,
              presentationTimeMs: presentationTimeMs(
                current.clocks.presentationTimeMs + elapsed,
              ),
            }),
          };
          revision++;
        }
      } else base.present(elapsed);
      const presentation = read().presentation;
      if (
        presentation.kind !== 'none' &&
        presentation.kind !== 'results' &&
        read().clocks.presentationTimeMs >= presentation.endsAt
      ) {
        overrides = {
          ...overrides,
          presentation: Object.freeze({ kind: 'results' }),
        };
        revision++;
      }
    },
  };
  return {
    core,
    script: (
      change: Partial<GameSnapshot>,
      emitted: readonly DomainEvent[] = [],
    ) => {
      overrides = { ...overrides, ...change };
      events = emitted;
      revision++;
    },
  };
}

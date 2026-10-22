import type {
  CoreCommand,
  CoreOutput,
  CorePort,
  DurationMs,
  FixedStep,
  GameplayInputBatch,
  SpatialStepResult,
} from '../contracts';
import { immutableDto } from '../app/immutableDto';
export type ReplayEntry =
  | { readonly kind: 'command'; readonly value: CoreCommand }
  | { readonly kind: 'input'; readonly value: GameplayInputBatch }
  | { readonly kind: 'present'; readonly value: DurationMs }
  | { readonly kind: 'begin'; readonly value: FixedStep }
  | { readonly kind: 'complete'; readonly value: SpatialStepResult }
  | { readonly kind: 'drain' }
  | { readonly kind: 'fail'; readonly value: string }
  | { readonly kind: 'dispose' };
/** Caller retains run/seed/catalog fingerprint with the tape. No external uploads or hidden inputs. */
export function recordCore(original: CorePort) {
  const entries: ReplayEntry[] = [];
  const outputs: CoreOutput[] = [];
  const add = (entry: ReplayEntry) => entries.push(immutableDto(entry));
  const core: CorePort = {
    read: () => original.read(),
    handle(value) {
      add({ kind: 'command', value });
      original.handle(value);
    },
    handleInputBatch(value) {
      add({ kind: 'input', value });
      original.handleInputBatch(value);
    },
    present(value) {
      add({ kind: 'present', value });
      original.present(value);
    },
    beginStep(value) {
      add({ kind: 'begin', value });
      return original.beginStep(value);
    },
    completeStep(value) {
      add({ kind: 'complete', value });
      const output = original.completeStep(value);
      outputs.push(immutableDto(output));
      return output;
    },
    drain() {
      add({ kind: 'drain' });
      const output = original.drain();
      outputs.push(immutableDto(output));
      return output;
    },
    fail(value) {
      add({ kind: 'fail', value });
      original.fail(value);
    },
    dispose() {
      add({ kind: 'dispose' });
      original.dispose();
    },
  };
  return {
    core,
    read: () => immutableDto(entries),
    outputs: () => immutableDto(outputs),
  };
}
export function replayCore(core: CorePort, entries: readonly ReplayEntry[]) {
  const outputs: CoreOutput[] = [];
  for (const entry of entries)
    switch (entry.kind) {
      case 'command':
        core.handle(entry.value);
        break;
      case 'input':
        core.handleInputBatch(entry.value);
        break;
      case 'present':
        core.present(entry.value);
        break;
      case 'begin':
        core.beginStep(entry.value);
        break;
      case 'complete':
        outputs.push(core.completeStep(entry.value));
        break;
      case 'drain':
        outputs.push(core.drain());
        break;
      case 'fail':
        core.fail(entry.value);
        break;
      case 'dispose':
        core.dispose();
        break;
    }
  return immutableDto({ snapshot: core.read(), outputs });
}

/** Record AI's public commands too: its held camera basis is an external input. */
export function recordIntentProvider(
  provider: Exclude<
    import('./createCore').CoreOptions['enemyAi'],
    false | undefined
  >,
) {
  const entries: (readonly import('../contracts').GameplayCommand[])[] = [];
  return {
    decide: ((snapshot, spatial) => {
      const commands = immutableDto(provider(snapshot, spatial));
      entries.push(commands);
      return commands;
    }) as Exclude<
      import('./createCore').CoreOptions['enemyAi'],
      false | undefined
    >,
    read: () => immutableDto(entries),
  };
}
export function replayIntentProvider(
  entries: readonly (readonly import('../contracts').GameplayCommand[])[],
): Exclude<import('./createCore').CoreOptions['enemyAi'], false | undefined> {
  const tape = immutableDto(entries);
  let index = 0;
  return () => {
    const commands = tape[index++];
    if (!commands) throw new Error('Recorded AI input tape exhausted');
    return commands;
  };
}

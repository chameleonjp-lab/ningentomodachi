import { expectTypeOf, test } from 'vitest';
import type {
  ActorId,
  GameSnapshot,
  HostRequest,
  HostSnapshot,
  PauseReason,
  PresentationState,
  PresentationTimeMs,
  StartupState,
} from '../../src/contracts';

test('logical roster is distinct from immutable resident robot selection', () => {
  expectTypeOf<GameSnapshot['residentActorIds']>().toEqualTypeOf<
    readonly ActorId[] | undefined
  >();
});

test('finishing transition retains the authoritative presentation clock', () => {
  type Stage = Exclude<PresentationState, { kind: 'none' | 'results' }>;
  expectTypeOf<'opponent-defeat-finish'>().toExtend<Stage['kind']>();
  expectTypeOf<Stage['startedAt']>().toEqualTypeOf<PresentationTimeMs>();
  expectTypeOf<Stage['endsAt']>().toEqualTypeOf<PresentationTimeMs>();
});

test('startup is an optional host-owned countdown and readiness conjunction', () => {
  type Startup = NonNullable<HostSnapshot['startup']>;
  expectTypeOf<Startup['countdown']>().toEqualTypeOf<0 | 1 | 2 | 3>();
  expectTypeOf<Startup['requiredAssetsReady']>().toEqualTypeOf<boolean>();
  expectTypeOf<Startup['pauseReasons']>().toEqualTypeOf<
    readonly PauseReason[]
  >();
});

test('startup pause and resume target generation and one pause reason without a run ID', () => {
  type Request = Extract<
    HostRequest,
    { type: 'StartupPauseRequested' | 'StartupResumeRequested' }
  >;
  expectTypeOf<Request['startupGeneration']>().toEqualTypeOf<number>();
  expectTypeOf<Request['reason']>().toEqualTypeOf<PauseReason>();
  expectTypeOf<StartupState['generation']>().toEqualTypeOf<number>();
});

// Compiler-enforced negative cases; implementations own temporal/runtime validation.
function immutableLifecycle(snapshot: GameSnapshot, startup: StartupState) {
  // @ts-expect-error Consumers cannot mutate Core residency.
  snapshot.residentActorIds = [];
  // @ts-expect-error The resident set cannot be extended by a renderer.
  snapshot.residentActorIds?.push(snapshot.actors[0].actorId);
  // @ts-expect-error D does not own the countdown.
  startup.countdown = 0;
  // @ts-expect-error Pause reasons are immutable published state.
  startup.pauseReasons.push('manual');
  // @ts-expect-error Countdown is bounded to the supplied display values.
  const invalid: StartupState = { ...startup, countdown: 4 };
  return invalid;
}
void immutableLifecycle;

import { expectTypeOf, test } from 'vitest';
import {
  type ActorRenderHostPort,
  actorId,
  type DefeatPoseSupportObservation,
  gameTimeMs,
  type PresentationTimeMs,
  type Tick,
  type Vector3,
} from '../../src/contracts';

test('pose support exposes immutable bounds and distinct frame/presentation identities', () => {
  expectTypeOf<
    DefeatPoseSupportObservation['defeatStartedAt']
  >().toEqualTypeOf<PresentationTimeMs>();
  expectTypeOf<
    DefeatPoseSupportObservation['presentationTimeMs']
  >().toEqualTypeOf<PresentationTimeMs>();
  expectTypeOf<DefeatPoseSupportObservation['tick']>().toEqualTypeOf<Tick>();
  expectTypeOf<
    DefeatPoseSupportObservation['currentLocalBounds']
  >().toEqualTypeOf<{ readonly min: Vector3; readonly max: Vector3 }>();
});

test('bounds capability is explicit while legacy hosts remain structurally compatible', () => {
  type Host = ActorRenderHostPort<{ readonly label: string }>;
  type Mount = Parameters<Host['mountActor']>[0];
  expectTypeOf<Mount['defeatPoseSupport']>().toEqualTypeOf<
    'bounds-v1' | undefined
  >();
  expectTypeOf<Host['publishDefeatPoseSupport']>().toEqualTypeOf<
    ((observation: DefeatPoseSupportObservation) => boolean) | undefined
  >();
});

// Compiler-enforced negative cases are not executed; C owns runtime validation.
function immutableSupportContract(observation: DefeatPoseSupportObservation) {
  // @ts-expect-error A frame's support identity cannot be rewritten.
  observation.actorId = actorId('replacement');
  // @ts-expect-error Stable entry support is not mutable by a consumer.
  observation.entryLocalMinY = 0;
  // @ts-expect-error Nested bounds remain immutable.
  observation.currentLocalBounds.min.y = 0;
  // @ts-expect-error Death presentation timestamps are not simulation time.
  const wrongClock: PresentationTimeMs = gameTimeMs(0);
  const wrongRun: DefeatPoseSupportObservation = {
    ...observation,
    // @ts-expect-error A publisher cannot substitute an actor ID for the run identity.
    runId: actorId('white'),
  };
  return [wrongClock, wrongRun];
}
void immutableSupportContract;

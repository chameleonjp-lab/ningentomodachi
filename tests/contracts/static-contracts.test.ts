import { expect, test } from 'vitest';
import {
  actorId,
  gameTimeMs,
  vehicleId,
  type GameSnapshot,
  type ActiveRealTimeMs,
  type ActorId,
} from '../../src/contracts';
// These negative cases are compiled by typecheck and are not invoked at runtime.
function staticContractSafety(snapshot: GameSnapshot) {
  // @ts-expect-error Actor IDs and vehicle IDs are not interchangeable.
  const wrongActor: ActorId = vehicleId('car');
  // @ts-expect-error Game time and pause-excluded real time are distinct units.
  const wrongClock: ActiveRealTimeMs = gameTimeMs(10);
  // @ts-expect-error Consumers cannot mutate committed snapshots.
  snapshot.phase = 'running';
  // @ts-expect-error Consumers cannot mutate nested clocks.
  snapshot.clocks.tick = 0;
  // @ts-expect-error Consumers cannot push new actors into a snapshot.
  snapshot.actors.push({ actorId: actorId('fake') });
  return [wrongActor, wrongClock];
}
test('compile-time contract safety cases are included in the project', () => {
  expect(staticContractSafety).toBeTypeOf('function');
});

function internalAndRenderSafety(
  command: import('../../src/contracts').CoreCommand,
  host: import('../../src/contracts').ActorRenderHostPort<{
    readonly label: string;
  }>,
  run: import('../../src/contracts').RunId,
) {
  if (command.type === 'AssetsReady') {
    // @ts-expect-error Internal readiness is not a public input/UI request.
    const external: import('../../src/contracts').GameCommand = command;
    return external;
  }
  const wrongRequest = {
    runId: run,
    actorId: actorId('white'),
    node: { wrongEngine: true },
  };
  // @ts-expect-error The public generic binding rejects a different renderer node type.
  host.mountActor(wrongRequest);
  return command;
}
test('internal lifecycle and renderer node bindings stay type-safe', () => {
  expect(internalAndRenderSafety).toBeTypeOf('function');
});

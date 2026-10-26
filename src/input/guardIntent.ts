import {
  captureGuardRequested,
  type ActorId,
  type GuardRequested,
  type InputModuleContext,
  type InputPacket,
} from '../contracts';

/** Semantic intent only: neither a held button nor this packet proves protection. */
export function toGuardIntent(
  active: boolean,
  context: Pick<InputModuleContext, 'runId' | 'readSnapshot'>,
  input: InputPacket,
  selectedActor?: ActorId,
): GuardRequested | null {
  const snapshot = selectedActor ? null : context.readSnapshot();
  const actorId =
    selectedActor ??
    (snapshot?.runId === context.runId
      ? snapshot.actors.find((actor) => actor.color === 'white')?.actorId
      : undefined);
  if (!actorId) return null;
  return captureGuardRequested({
    type: 'GuardRequested',
    runId: context.runId,
    actorId,
    active,
    input,
  });
}

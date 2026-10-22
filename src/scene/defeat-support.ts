import { deathClipSeconds } from '../assets';
import type {
  ActorState,
  DefeatPoseSupportObservation,
  GameSnapshot,
  SpatialActor,
  Vector3,
} from '../contracts';
import { add, localToWorld, v } from '../world/math';

export function validSupport(o: DefeatPoseSupportObservation): boolean {
  const b = o.currentLocalBounds;
  // Public adapters may be called from JavaScript. Validate nested structure
  // before touching coordinates; malformed data is rejection, not an exception.
  if (
    !b ||
    typeof b !== 'object' ||
    !b.min ||
    typeof b.min !== 'object' ||
    !b.max ||
    typeof b.max !== 'object'
  )
    return false;
  return (
    [
      o.defeatStartedAt,
      o.tick,
      o.presentationTimeMs,
      o.entryLocalMinY,
      b.min.x,
      b.min.y,
      b.min.z,
      b.max.x,
      b.max.y,
      b.max.z,
    ].every(Number.isFinite) &&
    Number.isInteger(o.tick) &&
    o.tick >= 0 &&
    o.defeatStartedAt >= 0 &&
    o.presentationTimeMs >= 0 &&
    b.min.x <= b.max.x &&
    b.min.y <= b.max.y &&
    b.min.z <= b.max.z
  );
}
/** Uses only the published display bounds and durable authority clock, never skin data. */
export function supportedPose(
  actor: SpatialActor,
  state: ActorState,
  snapshot: GameSnapshot,
  observation: DefeatPoseSupportObservation | undefined,
) {
  const death = state.defeatPresentation,
    o = observation;
  if (
    !death ||
    !o ||
    o.runId !== snapshot.runId ||
    o.actorId !== actor.actorId ||
    o.defeatStartedAt !== death.startedAt ||
    o.tick !== snapshot.clocks.tick ||
    o.presentationTimeMs !== snapshot.clocks.presentationTimeMs
  )
    throw new Error('Missing or mismatched defeated pose support');
  const progress =
    deathClipSeconds(death, snapshot.clocks.presentationTimeMs) / 0.5;
  if (
    progress === 0 &&
    Math.abs(o.entryLocalMinY - o.currentLocalBounds.min.y) > 1e-9
  )
    throw new Error('Defeat entry support differs from the displayed t0 pose');
  const initial = actor.position.y + o.entryLocalMinY;
  const desired = initial + (0.002 - initial) * progress;
  const offset = desired - actor.position.y - o.currentLocalBounds.min.y;
  const corners: Vector3[] = [];
  for (const x of [o.currentLocalBounds.min.x, o.currentLocalBounds.max.x])
    for (const y of [o.currentLocalBounds.min.y, o.currentLocalBounds.max.y])
      for (const z of [o.currentLocalBounds.min.z, o.currentLocalBounds.max.z])
        corners.push(
          add(
            add(actor.position, v(0, offset, 0)),
            localToWorld(v(x, y, z), actor.facing),
          ),
        );
  return { offset, corners };
}

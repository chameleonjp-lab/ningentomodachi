import type { ActorColor, ActorId, GameSnapshot } from '../contracts';
import type { ActorRig, AnimatorAssets } from '../assets';

/** Per-run resource ownership, not a replacement for B/C retirement guards.
 * The loading Core snapshot is the only authority for IDs and initial residency. */
export function createResidentAssetStage<Node>(
  initial: GameSnapshot,
  source: AnimatorAssets<Node>,
  yieldTask: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 0)),
) {
  const run = initial.runId;
  const roster = new Map<ActorId, ActorColor>();
  const colors = new Set<ActorColor>();
  for (const actor of initial.actors) {
    if (roster.has(actor.actorId) || colors.has(actor.color))
      throw new Error('Invalid authoritative actor roster');
    roster.set(actor.actorId, actor.color);
    colors.add(actor.color);
  }
  const required = initial.residentActorIds?.slice();
  if (
    !required?.length ||
    new Set(required).size !== required.length ||
    required.some((id) => !roster.has(id))
  )
    throw new Error('Required resident plan is unavailable');
  const pending = new Map<ActorId, ActorRig<Node>>();
  const transferred = new Set<ActorId>();
  let disposed = false;
  let started = false;
  let prepared = false;
  let lease: ReadonlyMap<ActorColor, ActorId> | null = null;
  const check = (signal: AbortSignal) => {
    if (disposed || signal.aborted) throw new Error('Run assets cancelled');
  };
  const acceptCreated = (rig: ActorRig<Node>) => {
    // A provider can synchronously trigger disposal before returning ownership.
    if (!disposed) return rig;
    try {
      rig.dispose();
    } catch {
      /* Cancellation remains the original failure. */
    }
    throw new Error('Run assets cancelled');
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lease = null;
    const rigs = [...pending.values()];
    pending.clear();
    transferred.clear();
    const errors: unknown[] = [];
    for (const rig of rigs) {
      try {
        rig.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Pending rig cleanup failed');
  };
  const assets: AnimatorAssets<Node> = {
    locomotionClips: source.locomotionClips,
    clipDuration: (id) => source.clipDuration(id),
    create(color) {
      if (disposed || !prepared || !lease)
        throw new Error('Rig allocation requires an active render lease');
      const id = lease.get(color);
      if (!id || roster.get(id) !== color || transferred.has(id))
        throw new Error('Invalid or repeated actor allocation');
      const rig = pending.get(id) ?? acceptCreated(source.create(color));
      pending.delete(id);
      transferred.add(id);
      return rig;
    },
  };
  return {
    assets,
    async prepare(signal: AbortSignal) {
      if (started) throw new Error('Resident preparation already started');
      started = true;
      try {
        for (let i = 0; i < required.length; i++) {
          check(signal);
          const id = required[i]!;
          const rig = acceptCreated(source.create(roster.get(id)!));
          pending.set(id, rig);
          check(signal);
          if (i + 1 < required.length) {
            await yieldTask();
            check(signal);
          }
        }
        prepared = true;
      } catch (error) {
        try {
          dispose();
        } catch {
          /* Preserve the original preparation failure. */
        }
        throw error;
      }
    },
    render(snapshot: GameSnapshot, draw: () => void) {
      if (
        disposed ||
        !prepared ||
        lease ||
        snapshot.runId !== run ||
        snapshot.actors.length !== roster.size
      )
        throw new Error('Invalid rig allocation frame');
      const seen = new Set<ActorId>();
      for (const actor of snapshot.actors) {
        if (
          seen.has(actor.actorId) ||
          roster.get(actor.actorId) !== actor.color
        )
          throw new Error('Actor identity does not match the Core roster');
        seen.add(actor.actorId);
      }
      const resident = snapshot.residentActorIds;
      if (
        !resident ||
        new Set(resident).size !== resident.length ||
        resident.some((id) => !roster.has(id))
      )
        throw new Error('Invalid resident allocation frame');
      lease = new Map(resident.map((id) => [roster.get(id)!, id]));
      try {
        draw();
      } finally {
        lease = null;
      }
    },
    dispose,
  };
}

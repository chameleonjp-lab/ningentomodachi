import {
  commandId,
  type GameSnapshot,
  type GameplayCommand,
  type MovementBasisSnapshot,
  type MovementSessionPort,
  type SpatialSnapshot,
} from '../contracts';
/** Provisional deterministic approach/attack policy. No bypass of Core action permissions.
 * A's composition injects the SAME C-backed session service as player movement. */
export function createEnemyAi(
  movement: Pick<MovementSessionPort, 'begin' | 'end'>,
  attackDistanceM = 1.8,
) {
  if (!Number.isFinite(attackDistanceM) || attackDistanceM <= 0)
    throw new RangeError('AI range must be positive');
  let attackChoices = 0;
  let sequence = 0,
    gesture = 0;
  let held: MovementBasisSnapshot | null = null;
  function release() {
    if (held) {
      movement.end(held.sessionId, 'cancelled');
      held = null;
    }
  }
  return {
    decide(
      snapshot: GameSnapshot,
      spatial: SpatialSnapshot | null,
    ): readonly GameplayCommand[] {
      const enemy = snapshot.actors.find(
          (a) => a.actorId === snapshot.currentOpponentId,
        ),
        white = snapshot.actors.find((a) => a.color === 'white');
      if (
        snapshot.phase !== 'running' ||
        snapshot.presentation.kind !== 'none' ||
        !enemy ||
        !white ||
        enemy.defeated ||
        !spatial ||
        spatial.runId !== snapshot.runId
      ) {
        release();
        return [];
      }
      const a = spatial.actors.find((a) => a.actorId === enemy.actorId),
        b = spatial.actors.find((a) => a.actorId === white.actorId);
      if (!a || !b) {
        release();
        return [];
      }
      const dx = b.position.x - a.position.x,
        dz = b.position.z - a.position.z,
        distance = Math.hypot(dx, dz);
      const input = () => ({
        commandId: commandId(`${snapshot.runId}:ai:${++sequence}`),
        sequence,
      });
      if (distance <= attackDistanceM) {
        release();
        // Provisional alternating category intent; Core still randomly selects within the fixed set.
        const preferred =
          enemy.color === 'black' || attackChoices % 2 === 0 ? 'kick' : 'punch';
        const category = enemy.actions[preferred].allowed ? preferred : null;
        if (category) attackChoices++;
        return category
          ? [
              {
                type: 'AttackRequested',
                runId: snapshot.runId,
                actorId: enemy.actorId,
                category,
                input: input(),
              },
            ]
          : [];
      }
      if (!enemy.actions.move.allowed) {
        release();
        return [];
      }
      if (held && held.runId !== snapshot.runId) release();
      if (!held)
        held = movement.begin(`${snapshot.runId}:ai-gesture:${++gesture}`);
      if (held.runId !== snapshot.runId) {
        release();
        return [];
      }
      const x = (dx * held.right.x + dz * held.right.z) / distance,
        z = (dx * held.depth.x + dz * held.depth.z) / distance;
      const length = Math.max(1, Math.hypot(x, z));
      return [
        {
          type: 'MoveRequested',
          runId: snapshot.runId,
          actorId: enemy.actorId,
          x: x / length,
          z: z / length,
          movementSessionId: held.sessionId,
          basisRevision: held.revision,
          input: input(),
        },
      ];
    },
    dispose: release,
  };
}

import {
  commandId,
  type ActorId,
  type GameCommand,
  type InputModuleContext,
  type InputPort,
  type InputReleaseReason,
  type MovementBasisSnapshot,
} from '../contracts';
export type ControlAction = 'move' | 'punch' | 'kick' | 'jump';
export interface PointerInput extends InputPort {
  pointerDown(
    pointerId: number,
    action: ControlAction,
    x: number,
    y: number,
  ): void;
  pointerMove(pointerId: number, x: number, y: number): void;
  pointerUp(pointerId: number, cancelled?: boolean): void;
  cancel(reason: InputReleaseReason): void;
}
export function createPointerInput(
  context: InputModuleContext,
  selectedActor?: ActorId,
): PointerInput {
  let enabled = false;
  let disposed = false;
  let sequence = 0;
  let gesture = 0;
  const listeners = new Set<(command: GameCommand) => void>();
  const pointers = new Map<number, ControlAction>();
  let movement: {
    pointerId: number;
    x: number;
    y: number;
    basis: MovementBasisSnapshot;
    actorId: ActorId;
  } | null = null;
  const emit = (command: GameCommand) => {
    for (const listener of [...listeners]) listener(command);
  };
  const packet = () => {
    sequence++;
    return {
      commandId: commandId(`${context.runId}:input:${sequence}`),
      sequence,
    };
  };
  const clear = () => {
    pointers.clear();
    movement = null;
  };
  return {
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setGate(gate) {
      if (disposed || gate.runId !== context.runId) return;
      enabled = gate.enabled;
      if (!enabled) clear();
    },
    releaseAll: clear,
    pointerDown(pointerId, action, x, y) {
      if (
        !enabled ||
        disposed ||
        pointers.has(pointerId) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      )
        return;
      const actorId =
        selectedActor ??
        context.readSnapshot()?.actors.find((actor) => actor.color === 'white')
          ?.actorId;
      if (!actorId) return;
      if (action === 'move') {
        if (movement) return;
        const basis = context.movement.begin(
          `${context.runId}:gesture:${++gesture}`,
        );
        if (basis.runId !== context.runId) return;
        movement = { pointerId, x, y, basis, actorId };
        pointers.set(pointerId, action);
        emit({
          type: 'MoveRequested',
          runId: context.runId,
          actorId,
          x: 0,
          z: 0,
          movementSessionId: basis.sessionId,
          basisRevision: basis.revision,
          input: packet(),
        });
      } else {
        pointers.set(pointerId, action);
        if (action === 'jump')
          emit({
            type: 'JumpRequested',
            runId: context.runId,
            actorId,
            input: packet(),
          });
        else
          emit({
            type: 'AttackRequested',
            runId: context.runId,
            actorId,
            category: action,
            input: packet(),
          });
      }
    },
    pointerMove(pointerId, x, y) {
      if (
        !enabled ||
        disposed ||
        movement?.pointerId !== pointerId ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      )
        return;
      const dx = (x - movement.x) / 64;
      const dz = (movement.y - y) / 64;
      const length = Math.max(1, Math.hypot(dx, dz));
      emit({
        type: 'MoveRequested',
        runId: context.runId,
        actorId: movement.actorId,
        x: dx / length,
        z: dz / length,
        movementSessionId: movement.basis.sessionId,
        basisRevision: movement.basis.revision,
        input: packet(),
      });
    },
    pointerUp(pointerId, cancelled = false) {
      pointers.delete(pointerId);
      if (movement?.pointerId === pointerId) {
        const session = movement.basis.sessionId;
        movement = null;
        context.movement.end(session, cancelled ? 'cancelled' : 'released');
      }
    },
    cancel(reason) {
      clear();
      if (!disposed) context.movement.releaseAll(reason);
    },
    dispose() {
      if (disposed) return;
      clear();
      enabled = false;
      disposed = true;
      listeners.clear();
      context.movement.releaseAll('dispose');
    },
  };
}

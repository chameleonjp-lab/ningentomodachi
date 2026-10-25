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
    jumpFired: boolean;
    crouchHeld: boolean;
    crouchPending: boolean | null;
    crouchRequestedAtTick: number | null;
    update: number;
    vertical: 'up' | 'down' | null;
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
        movement = {
          pointerId,
          x,
          y,
          basis,
          actorId,
          jumpFired: false,
          crouchHeld: false,
          crouchPending: null,
          crouchRequestedAtTick: null,
          update: 0,
          vertical: null,
        };
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
      const current = movement;
      const dx = x - current.x;
      const dy = y - current.y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const update = ++current.update;
      const vertical =
        Math.abs(dy) >= 32 && Math.abs(dy) >= Math.abs(dx) * 1.25
          ? dy < 0
            ? 'up'
            : 'down'
          : null;
      const inDeadzone = Math.hypot(dx, dy) <= 12;
      const snapshot = context.readSnapshot();
      const actor = snapshot?.actors.find(
        (actor) => actor.actorId === current.actorId,
      );
      // A false stance after an admitted tick is authoritative even if an
      // entire attack occurred between pointer events. Before that tick the
      // true request may still be queued, so unrelated publications cannot
      // clear its optimistic hold. Neither observation rearms a down crossing.
      if (
        current.crouchHeld &&
        current.crouchPending !== true &&
        snapshot &&
        actor &&
        !actor.crouching &&
        (actor.attack ||
          (current.crouchRequestedAtTick !== null &&
            snapshot.clocks.tick > current.crouchRequestedAtTick))
      ) {
        current.crouchHeld = false;
        current.crouchRequestedAtTick = null;
      }
      const releaseCrouch = current.crouchHeld && (inDeadzone || dy <= 0);
      const startCrouch = vertical === 'down' && current.vertical !== 'down';
      const jump = vertical === 'up' && !current.jumpFired;
      current.vertical = vertical;
      if (releaseCrouch || startCrouch) {
        current.crouchHeld = startCrouch;
        current.crouchPending = startCrouch;
      }
      // Every event is lateral OR vertical. Retain the session's captured
      // basis, but never translate a vertical swipe into depth travel.
      emit({
        type: 'MoveRequested',
        runId: context.runId,
        actorId: current.actorId,
        x:
          vertical || inDeadzone || current.crouchHeld
            ? 0
            : Math.max(-1, Math.min(1, dx / 64)),
        z: 0,
        movementSessionId: current.basis.sessionId,
        basisRevision: current.basis.revision,
        input: packet(),
      });
      if (movement !== current || current.update !== update) return;
      if (current.crouchPending !== null) {
        const active = current.crouchPending;
        current.crouchPending = null;
        current.crouchRequestedAtTick = active
          ? (context.readSnapshot()?.clocks.tick ?? null)
          : null;
        emit({
          type: 'CrouchRequested',
          runId: context.runId,
          actorId: current.actorId,
          active,
          movementSessionId: current.basis.sessionId,
          basisRevision: current.basis.revision,
          input: packet(),
        });
      }
      if (movement !== current || current.update !== update) return;
      if (jump) {
        current.jumpFired = true;
        emit({
          type: 'JumpRequested',
          runId: context.runId,
          actorId: current.actorId,
          input: packet(),
        });
      }
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

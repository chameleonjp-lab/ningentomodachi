import type {
  ActorId,
  CoreOutput,
  GameSnapshot,
  LaunchId,
  RunId,
  SpatialActor,
  SpatialCandidate,
  SpatialVehicle,
  VehicleId,
} from '../contracts';
import { body, toBox } from './character-motor';
import {
  type ActorTrajectory,
  attackSweeps,
  envelope,
  positionAt,
} from './contact-candidates';
import { add, length, mul, sub, v } from './math';
import type { StreetLayout } from './street-layout';
import { interpolateVolume, sweepBox, sweepVolumes } from './swept-shapes';

interface Flight {
  readonly launchId: LaunchId;
  readonly actorId: ActorId;
}
export function createVehicleSystem(run: RunId, layout: StreetLayout) {
  const poses = new Map<VehicleId, SpatialVehicle>(),
    flights = new Map<VehicleId, Flight>(),
    events = new Set<string>(),
    launches = new Set<LaunchId>();
  let lastEventSequence = 0;
  return {
    commit(output: CoreOutput, actors: ReadonlyMap<ActorId, SpatialActor>) {
      for (const authority of output.snapshot.world.vehicles)
        if (!poses.has(authority.vehicleId)) {
          const item = layout.vehicles.find(
            (v) => v.vehicleId === authority.vehicleId,
          );
          if (!item) throw new Error('Vehicle geometry missing');
          poses.set(authority.vehicleId, {
            vehicleId: authority.vehicleId,
            position: { ...item.position },
            velocity: v(),
            grounded: true,
            launchId: null,
          });
        }
      for (const event of output.events) {
        if (
          event.runId !== run ||
          events.has(event.eventId) ||
          event.sequence <= lastEventSequence
        )
          continue;
        lastEventSequence = event.sequence;
        events.add(event.eventId);
        if (
          event.type !== 'VehicleLaunchApproved' ||
          launches.has(event.launchId) ||
          output.snapshot.phase !== 'running'
        )
          continue;
        const authority = output.snapshot.world.vehicles.find(
            (v) => v.vehicleId === event.vehicleId,
          ),
          pose = poses.get(event.vehicleId),
          source = actors.get(event.actorId);
        if (
          !authority ||
          authority.broken ||
          authority.activeLaunchId !== event.launchId ||
          !pose ||
          !source
        )
          continue;
        launches.add(event.launchId);
        flights.set(event.vehicleId, {
          launchId: event.launchId,
          actorId: event.actorId,
        });
        poses.set(event.vehicleId, {
          ...pose,
          launchId: event.launchId,
          velocity: add(mul(source.facing, 14), v(0, 3, 0)),
          grounded: false,
        });
      }
    },
    read(): SpatialVehicle[] {
      return [...poses.values()].map((p) => ({
        ...p,
        position: { ...p.position },
        velocity: { ...p.velocity },
      }));
    },
    step(
      state: GameSnapshot,
      from: number,
      to: number,
      actors: readonly ActorTrajectory[],
    ): SpatialCandidate[] {
      const result: SpatialCandidate[] = [];
      const dt = (to - from) / 1000;
      for (const [id, pose] of poses) {
        const flight = flights.get(id);
        if (!flight || length(pose.velocity) < 0.05) continue;
        const velocity = add(pose.velocity, v(0, -9.81 * dt, 0));
        let end = add(
          pose.position,
          add(mul(pose.velocity, dt), v(0, -4.905 * dt * dt, 0)),
        );
        const shape = (position: SpatialVehicle['position']) => ({
          kind: 'capsule' as const,
          start: add(position, v(0, 0.7, -0.9)),
          end: add(position, v(0, 0.7, 0.9)),
          radiusM: 0.9,
        });
        const a = shape(pose.position),
          b = shape(end);
        let stop = 1;
        const wallContacts: SpatialCandidate[] = [];
        for (const object of layout.objects) {
          const authority = state.world.objects.find(
            (o) => o.objectId === object.objectId,
          );
          const hit = sweepBox(
            a,
            b,
            toBox(object.position, object.halfExtents),
          );
          if (hit) {
            stop = Math.min(stop, hit.fraction);
            if (authority && !authority.destroyed)
              wallContacts.push({
                ...envelope(
                  run,
                  'destruction',
                  [flight.launchId, object.objectId],
                  from,
                  to,
                  hit,
                ),
                kind: 'destruction',
                sourceActorId: flight.actorId,
                targetId: object.objectId,
                launchId: flight.launchId,
                contactSpeedMps: length(pose.velocity),
              });
          }
        }
        result.push(
          ...wallContacts.filter(
            (c) => c.at <= from + (to - from) * stop + 1e-8,
          ),
        );
        for (const actor of actors) {
          if (actor.state.actorId === flight.actorId) continue;
          const cuts = [
            from,
            ...actor.path.map((k) => k.at).filter((t) => t > from && t < to),
            to,
          ];
          for (let i = 1; i < cuts.length; i++) {
            const begin = cuts[i - 1],
              endTime = cuts[i];
            if (begin === undefined || endTime === undefined)
              throw new Error('Invalid target path');
            if (begin > from + (to - from) * stop) break;
            const hit = sweepVolumes(
              interpolateVolume(a, b, (begin - from) / (to - from)),
              interpolateVolume(a, b, (endTime - from) / (to - from)),
              body(positionAt(actor.path, begin)),
              body(positionAt(actor.path, endTime)),
            );
            if (
              hit &&
              begin + (endTime - begin) * hit.fraction <=
                from + (to - from) * stop
            )
              result.push({
                ...envelope(
                  run,
                  'vehicle-contact',
                  [flight.launchId, actor.state.actorId],
                  begin,
                  endTime,
                  hit,
                ),
                kind: 'vehicle-contact',
                launchId: flight.launchId,
                vehicleId: id,
                targetActorId: actor.state.actorId,
              });
          }
        }
        if (stop < 1)
          end = add(
            pose.position,
            mul(sub(end, pose.position), Math.max(0, stop - 1e-6)),
          );
        const grounded = end.y <= 0;
        end = v(end.x, Math.max(0, end.y), end.z);
        const finalVelocity =
          stop < 1
            ? v()
            : grounded
              ? v(
                  velocity.x * Math.exp(-4 * dt),
                  0,
                  velocity.z * Math.exp(-4 * dt),
                )
              : velocity;
        poses.set(id, {
          ...pose,
          position: end,
          velocity: finalVelocity,
          grounded,
        });
      }
      for (const actor of actors)
        for (const sweep of attackSweeps(actor))
          for (const item of layout.vehicles) {
            const authority = state.world.vehicles.find(
                (v) => v.vehicleId === item.vehicleId,
              ),
              pose = poses.get(item.vehicleId);
            if (!authority || authority.broken || !pose) continue;
            const hit = sweepBox(
              sweep.start,
              sweep.end,
              toBox(
                add(pose.position, v(0, item.halfExtents.y, 0)),
                item.halfExtents,
              ),
            );
            if (hit) {
              const launch =
                actor.state.color === 'white' &&
                actor.state.attack?.category === 'kick' &&
                authority.canLaunch;
              result.push(
                launch
                  ? {
                      ...envelope(
                        run,
                        'vehicle-launch',
                        [sweep.source.impactId, item.vehicleId],
                        sweep.from,
                        sweep.to,
                        hit,
                      ),
                      kind: 'vehicle-launch',
                      source: sweep.source,
                      vehicleId: item.vehicleId,
                    }
                  : {
                      ...envelope(
                        run,
                        'destruction',
                        [sweep.source.impactId, item.vehicleId],
                        sweep.from,
                        sweep.to,
                        hit,
                      ),
                      kind: 'destruction',
                      source: sweep.source,
                      sourceActorId: sweep.source.actorId,
                      targetId: item.vehicleId,
                      launchId: null,
                      contactSpeedMps: 0,
                    },
              );
            }
          }
      return result;
    },
    dispose() {
      poses.clear();
      flights.clear();
      events.clear();
      launches.clear();
    },
  };
}

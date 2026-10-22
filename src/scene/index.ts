import { deathClipSeconds } from '../assets';
import {
  type Camera,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  CAMERA_NEAR,
  CAMERA_FAR,
  createCameraRig,
  initialCamera,
  projectPoint,
} from '../camera/camera-rig';
import type {
  ActorId,
  DefeatPoseSupportObservation,
  Vector3,
  CommittedFrame,
  ModuleContext,
  GameSnapshot,
  SpatialActor,
  Projection,
  SpatialModule,
  SpatialSnapshot,
} from '../contracts';
import { createSpatialEngine } from '../world/spatial-engine';
import {
  createParisStreetLayout,
  type StreetLayout,
} from '../world/street-layout';
import { createParisStreet } from './paris-street';
import { createWorldImpactFx } from './world-impact-fx';
import { validSupport, supportedPose } from './defeat-support';

export type { StreetLayout } from '../world/street-layout';
export { createParisStreetLayout } from '../world/street-layout';
export interface SceneRenderer {
  readonly domElement: HTMLCanvasElement;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}
export interface SceneOptions {
  readonly createRenderer?: () => SceneRenderer;
  readonly onInterruption: () => void;
  readonly root?: HTMLElement;
  readonly layout?: StreetLayout;
}
export function createSceneAdapter(
  context: ModuleContext,
  options: SceneOptions,
): SpatialModule<Object3D> {
  const layout = options.layout ?? createParisStreetLayout(),
    engine = createSpatialEngine(context.runId, layout, context.posePolicy);
  const scene = new Scene();
  scene.background = new Color(0xc9d5dc);
  const camera = new PerspectiveCamera(50, 1, CAMERA_NEAR, CAMERA_FAR);
  const rig = createCameraRig(layout);
  const street = createParisStreet(layout),
    fx = createWorldImpactFx(context.runId);
  scene.add(street.root, fx.root);
  scene.add(new HemisphereLight(0xe7f1ff, 0x6b6356, 2.5));
  const sun = new DirectionalLight(0xffedd2, 3);
  sun.position.set(-5, 15, 8);
  scene.add(sun);
  let renderer: SceneRenderer | undefined;
  let disposed = false,
    contextLost = false,
    frameCamera = initialCamera,
    lastPresentation: number | undefined;
  let cameraStamp: { tick: number; viewport: number } | undefined;
  let committed: SpatialSnapshot | undefined;
  let committedAuthority: GameSnapshot | undefined;
  const mounts = new Map<
    ActorId,
    {
      parent: Group;
      presentation: Group;
      node: Object3D;
      boundsQualified: boolean;
      observation?: DefeatPoseSupportObservation;
      entrySupport?: { startedAt: number; minY: number };
    }
  >();
  const nodes = new Set<Object3D>();
  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    options.onInterruption();
  };
  const onRestored = () => {
    contextLost = false;
  };
  const alive = () => {
    if (disposed) throw new Error('Scene disposed');
  };
  // C's current motor/scene uses the world plane Y=0. This offset is presentation
  // only: never write it into SpatialSnapshot, contacts, or the B-owned node.
  function settledActor(
    actor: SpatialActor,
    authority: GameSnapshot,
  ): SpatialActor {
    const state = authority.actors.find((a) => a.actorId === actor.actorId);
    const progress =
      state?.defeated && state.defeatPresentation
        ? deathClipSeconds(
            state.defeatPresentation,
            authority.clocks.presentationTimeMs,
          ) / 0.5
        : 0;
    return {
      ...actor,
      position: {
        ...actor.position,
        y: actor.position.y - Math.max(0, actor.position.y) * progress,
      },
    };
  }
  function applyPoses(
    spatial: SpatialSnapshot,
    authority?: GameSnapshot,
    onlyActorId?: ActorId,
    offsets?: ReadonlyMap<ActorId, number>,
  ) {
    for (const [id, mount] of mounts) {
      if (onlyActorId !== undefined && id !== onlyActorId) continue;
      const actor = spatial.actors.find((a) => a.actorId === id);
      mount.parent.visible = !!actor;
      if (!actor && engine.isRetired(id)) {
        delete mount.observation;
        delete mount.entrySupport;
      }
      if (actor) {
        const visual = authority ? settledActor(actor, authority) : actor;
        const offset = offsets?.get(id);
        if (offset !== undefined) mount.presentation.position.set(0, offset, 0);
        else if (
          !mount.boundsQualified ||
          !authority?.actors.find((a) => a.actorId === id)?.defeated
        )
          mount.presentation.position.set(
            0,
            visual.position.y - actor.position.y,
            0,
          );
        // An opted-in defeated mount is settled only after B supplies the exact
        // displayed pose. Commit/mount must not reuse an old observation.

        mount.parent.position.set(
          actor.position.x,
          actor.position.y,
          actor.position.z,
        );
        mount.parent.rotation.set(
          0,
          Math.atan2(actor.facing.x, actor.facing.z),
          0,
        );
      }
    }
  }
  try {
    renderer =
      options.createRenderer?.() ??
      new WebGLRenderer({ antialias: true, alpha: false });
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    if (options.root) options.root.appendChild(renderer.domElement);
  } catch (error) {
    const failures: unknown[] = [error];
    for (const cleanup of [
      () =>
        renderer?.domElement.removeEventListener('webglcontextlost', onLost),
      () =>
        renderer?.domElement.removeEventListener(
          'webglcontextrestored',
          onRestored,
        ),
      () => street.dispose(),
      () => fx.dispose(),
      () => engine.dispose(),
      () => renderer?.dispose(),
    ]) {
      try {
        cleanup();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, 'Scene creation and cleanup failed');
    throw error;
  }
  const output = renderer;
  return {
    renderHost: {
      runId: context.runId,
      publishDefeatPoseSupport(observation) {
        if (!observation || typeof observation !== 'object') return false;
        // Wrong-run rejection does not mutate this run. The rejected producer
        // must abort; false is never permission to draw using prior support.
        const mount = mounts.get(observation.actorId);
        if (
          disposed ||
          observation.runId !== context.runId ||
          engine.isRetired(observation.actorId) ||
          !mount?.boundsQualified
        )
          return false;
        if (!validSupport(observation)) {
          delete mount.observation;
          return false;
        }
        mount.observation = {
          ...observation,
          currentLocalBounds: {
            min: { ...observation.currentLocalBounds.min },
            max: { ...observation.currentLocalBounds.max },
          },
        };
        return true;
      },
      mountActor(request) {
        alive();
        if (engine.isRetired(request.actorId))
          throw new Error('Cannot mount retired actor');
        if (
          committedAuthority?.residentActorIds &&
          !committedAuthority.residentActorIds.includes(request.actorId)
        )
          throw new Error('Cannot mount nonresident actor');
        if (request.runId !== context.runId)
          throw new Error('Stale render run');
        if (
          mounts.has(request.actorId) ||
          nodes.has(request.node) ||
          request.node.parent
        )
          throw new Error('Duplicate or attached actor node');
        const parent = new Group();
        parent.name = `actor-anchor:${request.actorId}`;
        parent.visible = false;
        const presentation = new Group();
        presentation.name = `actor-presentation:${request.actorId}`;
        presentation.add(request.node);
        parent.add(presentation);
        scene.add(parent);
        mounts.set(request.actorId, {
          parent,
          presentation,
          node: request.node,
          boundsQualified: request.defeatPoseSupport === 'bounds-v1',
        });
        nodes.add(request.node);
        // Initialize only this mount. Existing anchors may display a replayed
        // frame rather than the latest commit, and mounting is not a render.
        if (committed)
          applyPoses(committed, committedAuthority, request.actorId);
        let detached = false;
        return () => {
          if (detached) return;
          detached = true;
          presentation.remove(request.node);
          parent.remove(presentation);
          scene.remove(parent);
          mounts.delete(request.actorId);
          nodes.delete(request.node);
        };
      },
    },
    ...(engine.poseProtocol ? { poseProtocol: engine.poseProtocol } : {}),
    step: (request, catalog) => {
      alive();
      return engine.step(request, catalog);
    },
    commit(authority, viewport) {
      alive();
      if (viewport.revision < 0) throw new RangeError('Invalid viewport');
      committed = engine.commit(authority);
      committedAuthority = authority.snapshot;
      fx.consume(authority);
      applyPoses(committed, authority.snapshot);
      return committed;
    },
    beginMovementSession(sessionId) {
      alive();
      return engine.begin(sessionId, frameCamera.right, frameCamera.depth);
    },
    endMovementSession(sessionId) {
      engine.end(sessionId);
    },
    render(frame: CommittedFrame) {
      alive();
      if (
        frame.snapshot.runId !== context.runId ||
        frame.spatial.runId !== context.runId
      )
        throw new Error('Stale render frame');
      engine.assertReplayAllowed(frame.snapshot);
      if (frame.spatial.actors.some((actor) => engine.isRetired(actor.actorId)))
        throw new Error('Cannot render retired spatial actor');
      // Validate every opted-in defeated mount before mutating presentation or drawing.
      const offsets = new Map<ActorId, number>();
      const framingPoints: Vector3[] = [];
      for (const [id, mount] of mounts) {
        const state = frame.snapshot.actors.find((a) => a.actorId === id);
        if (
          !mount.boundsQualified ||
          !state?.defeated ||
          (frame.snapshot.residentActorIds &&
            !frame.snapshot.residentActorIds.includes(id))
        )
          continue;
        const actor = frame.spatial.actors.find((a) => a.actorId === id);
        if (!actor || frame.spatial.tick !== frame.snapshot.clocks.tick)
          throw new Error('Missing defeated spatial frame');
        const supported = supportedPose(
          actor,
          state,
          frame.snapshot,
          mount.observation,
        );
        const observed = mount.observation!;
        if (
          mount.entrySupport?.startedAt === observed.defeatStartedAt &&
          mount.entrySupport.minY !== observed.entryLocalMinY
        )
          throw new Error('Defeat entry support changed within one activation');
        mount.entrySupport = {
          startedAt: observed.defeatStartedAt,
          minY: observed.entryLocalMinY,
        };
        offsets.set(id, supported.offset);
        framingPoints.push(...supported.corners);
      }
      const displayActors = frame.spatial.actors.map((actor) =>
        offsets.has(actor.actorId)
          ? actor
          : settledActor(actor, frame.snapshot),
      );
      const stagedOpponent =
        frame.snapshot.presentation.kind === 'opponent-defeat' ||
        frame.snapshot.presentation.kind === 'opponent-defeat-finish' ||
        frame.snapshot.presentation.kind === 'clear-slow'
          ? frame.snapshot.presentation.actorId
          : null;
      const playerId = frame.snapshot.actors.find(
          (a) => a.color === 'white',
        )?.actorId,
        player = displayActors.find((a) => a.actorId === playerId),
        opponent = displayActors.find(
          (a) =>
            a.actorId === (frame.snapshot.currentOpponentId ?? stagedOpponent),
        );
      const time = frame.snapshot.clocks.presentationTimeMs,
        elapsed =
          lastPresentation === undefined
            ? 0
            : Math.max(0, time - lastPresentation);
      lastPresentation = time;
      if (framingPoints.length) {
        for (const actor of [player, opponent])
          if (actor && !offsets.has(actor.actorId))
            for (const x of [-0.35, 0.35])
              for (const y of [0, 1.85])
                for (const z of [-0.35, 0.35])
                  framingPoints.push({
                    x: actor.position.x + x,
                    y: actor.position.y + y,
                    z: actor.position.z + z,
                  });
      }
      if (player)
        frameCamera = rig.update(
          player,
          opponent,
          frame.viewport,
          elapsed,
          framingPoints,
        );
      camera.position.set(
        frameCamera.position.x,
        frameCamera.position.y,
        frameCamera.position.z,
      );
      camera.lookAt(
        frameCamera.target.x,
        frameCamera.target.y,
        frameCamera.target.z,
      );
      camera.aspect =
        frame.viewport.widthCssPx / Math.max(1, frame.viewport.heightCssPx);
      camera.fov = frameCamera.fovDegrees;
      camera.updateProjectionMatrix();
      output.setPixelRatio(
        Math.min(
          frame.viewport.devicePixelRatio,
          frame.snapshot.quality === 'low' ? 1 : 2,
        ),
      );
      output.setSize(
        frame.viewport.widthCssPx,
        frame.viewport.heightCssPx,
        false,
      );
      cameraStamp = {
        tick: frame.spatial.tick,
        viewport: frame.viewport.revision,
      };
      applyPoses(frame.spatial, frame.snapshot, undefined, offsets);
      street.update(frame.snapshot, frame.spatial);
      fx.update(time);
      if (!contextLost) output.render(scene, camera);
    },
    project(frame): readonly Projection[] {
      alive();
      if (frame.snapshot.runId !== context.runId) return [];
      return frame.events.flatMap((event) =>
        event.type === 'HpChanged' && event.runId === context.runId
          ? [
              {
                eventId: event.eventId,
                runId: event.runId,
                actorId: event.actorId,
                viewportRevision: frame.viewport.revision,
                ...(cameraStamp?.tick === frame.spatial.tick &&
                cameraStamp.viewport === frame.viewport.revision
                  ? projectPoint(
                      event.contact.point,
                      frameCamera,
                      frame.viewport,
                    )
                  : { visibility: 'unprojectable' as const, cssPoint: null }),
              },
            ]
          : [],
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      const safely = (fn: () => void) => {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      };
      safely(() =>
        output.domElement.removeEventListener('webglcontextlost', onLost),
      );
      safely(() =>
        output.domElement.removeEventListener(
          'webglcontextrestored',
          onRestored,
        ),
      );
      for (const { parent, presentation, node } of mounts.values())
        safely(() => {
          presentation.remove(node);
          parent.remove(presentation);
          scene.remove(parent);
        });
      mounts.clear();
      nodes.clear();
      safely(() => street.dispose());
      safely(() => fx.dispose());
      safely(() => engine.dispose());
      safely(() => output.dispose());
      if (options.root && output.domElement.parentNode === options.root)
        safely(() => options.root?.removeChild(output.domElement));
      scene.clear();
      if (errors.length)
        throw new AggregateError(errors, 'Scene disposal failed');
    },
  };
}

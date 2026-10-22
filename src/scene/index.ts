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
  CommittedFrame,
  ModuleContext,
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
    engine = createSpatialEngine(context.runId, layout);
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
  const mounts = new Map<ActorId, { parent: Group; node: Object3D }>();
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
  function applyPoses(spatial: SpatialSnapshot) {
    for (const [id, mount] of mounts) {
      const actor = spatial.actors.find((a) => a.actorId === id);
      mount.parent.visible = !!actor;
      if (actor) {
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
      mountActor(request) {
        alive();
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
        parent.add(request.node);
        scene.add(parent);
        mounts.set(request.actorId, { parent, node: request.node });
        nodes.add(request.node);
        if (committed) applyPoses(committed);
        let detached = false;
        return () => {
          if (detached) return;
          detached = true;
          parent.remove(request.node);
          scene.remove(parent);
          mounts.delete(request.actorId);
          nodes.delete(request.node);
        };
      },
    },
    step: (request, catalog) => {
      alive();
      return engine.step(request, catalog);
    },
    commit(authority, viewport) {
      alive();
      if (viewport.revision < 0) throw new RangeError('Invalid viewport');
      committed = engine.commit(authority);
      fx.consume(authority);
      applyPoses(committed);
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
      const playerId = frame.snapshot.actors.find(
          (a) => a.color === 'white',
        )?.actorId,
        player = frame.spatial.actors.find((a) => a.actorId === playerId),
        opponent = frame.spatial.actors.find(
          (a) => a.actorId === frame.snapshot.currentOpponentId,
        );
      const time = frame.snapshot.clocks.presentationTimeMs,
        elapsed =
          lastPresentation === undefined
            ? 0
            : Math.max(0, time - lastPresentation);
      lastPresentation = time;
      if (player)
        frameCamera = rig.update(player, opponent, frame.viewport, elapsed);
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
      applyPoses(frame.spatial);
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
      for (const { parent, node } of mounts.values())
        safely(() => {
          parent.remove(node);
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

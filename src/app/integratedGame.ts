import type { Object3D } from 'three';
import { clipId } from '../contracts';
import type {
  ActorColor,
  MoveSet,
  RunContext,
  RunId,
  ModuleFactories,
} from '../contracts';
import {
  createActorAnimator,
  createMotionCatalog,
  type AnimatorAssets,
  type MotionAsset,
} from '../assets';
import { createCore, createEnemyAi, type WorldSeed } from '../core';
import {
  createSceneAdapter,
  createParisStreetLayout,
  type SceneRenderer,
  type StreetLayout,
} from '../scene';
import { createInterface } from '../ui';
import {
  createGame,
  type GameOptions,
  type GameController,
} from './createGame';
import { immutableDto } from './immutableDto';
import { createResidentAssetStage } from './residentAssets';

export interface PreparedGameAssets {
  readonly motions: readonly MotionAsset[];
  /** Release pack resources after the animation port has detached/disposed all actor rigs. */
  readonly animator: AnimatorAssets<Object3D> & { dispose(): void };
}
/** Explicit integration input, not evidence of acceptance. No production fixture fallback exists.
 * The caller must provide source-verified, reviewed motion/visual data and A-owned fixed move sets. */
export interface AcceptedGameConfiguration {
  readonly moves: Readonly<Record<ActorColor, MoveSet>>;
  readonly layout?: StreetLayout;
  readonly world: WorldSeed;
  loadAssets(
    context: RunContext,
    signal: AbortSignal,
  ): Promise<PreparedGameAssets>;
}
export interface IntegratedGameOptions extends GameOptions {
  readonly configuration?: AcceptedGameConfiguration;
  readonly createRenderer?: () => SceneRenderer;
}
/** Check every visual the configured run can request before catalog readiness unlocks input.
 * This proves structural coverage/timing only, never source or visual-art acceptance. */
function validateVisualCoverage(
  assets: PreparedGameAssets,
  moves: Readonly<Record<ActorColor, MoveSet>>,
): void {
  const durationOf = (id: ReturnType<typeof clipId>) => {
    if (typeof id !== 'string' || id.length === 0)
      throw new Error('Missing required animation clip ID');
    const duration = assets.animator.clipDuration(id);
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0)
      throw new Error(`Unavailable animation clip: ${id}`);
    return duration;
  };
  for (const state of ['idle', 'walk', 'run', 'jump'] as const)
    durationOf(assets.animator.locomotionClips[state]);
  for (const id of ['DefeatPunch', 'DefeatKick'])
    if (durationOf(clipId(id)) !== 500)
      throw new Error(`Death clip must be exactly 500ms: ${id}`);
  const definitions = new Map(
    assets.motions.map((motion) => [
      motion.definition.clipId,
      motion.definition,
    ]),
  );
  const required = new Set(
    Object.values(moves).flatMap((set) => [...set.punches, ...set.kicks]),
  );
  for (const id of required) {
    const definition = definitions.get(id);
    if (!definition)
      throw new Error(`Missing configured attack metadata: ${id}`);
    if (durationOf(id) !== definition.durationMs)
      throw new Error(`Attack animation/catalog duration mismatch: ${id}`);
  }
}
export function createIntegratedGame(
  root: HTMLElement,
  options: IntegratedGameOptions,
): GameController {
  let ui: ReturnType<typeof createInterface> | undefined;
  const interfaceForApp = () => (ui ??= createInterface(root));
  let game: GameController;
  type Bundle = {
    catalog: ReturnType<typeof createMotionCatalog>;
    assets: PreparedGameAssets | null;
    residents: ReturnType<typeof createResidentAssetStage<Object3D>> | null;
    ai: ReturnType<typeof createEnemyAi> | null;
    layout: StreetLayout;
    disposed: boolean;
    prepareAnimation: (() => void) | null;
  };
  const bundles = new Map<RunId, Bundle>();
  const get = (id: RunId) => {
    const bundle = bundles.get(id);
    if (!bundle) throw new Error('Run assets are unavailable');
    return bundle;
  };
  const factories: ModuleFactories<Object3D> = {
    host: (viewport) => interfaceForApp().host(viewport),
    core(context) {
      const config = options.configuration;
      if (!config)
        throw new Error(
          '承認済みモーション・表示データが未設定です (accepted assets unavailable)',
        );
      // Core and the asynchronous readiness check must use one per-run value.
      const moves = immutableDto(config.moves);
      const layout = immutableDto(config.layout ?? createParisStreetLayout());
      const matches = (a: readonly string[], b: readonly string[]) =>
        a.length === b.length &&
        new Set(a).size === a.length &&
        new Set(b).size === b.length &&
        a.every((id) => b.includes(id));
      if (
        !matches(
          layout.vehicles.map((v) => v.vehicleId),
          config.world.vehicles.map((v) => v.vehicleId),
        ) ||
        !matches(
          layout.objects.map((o) => o.objectId),
          config.world.objects.map((o) => o.objectId),
        )
      )
        throw new Error('Core durability IDs must match the scene layout');
      const bundle: Bundle = {
        catalog: createMotionCatalog(
          async (signal) => {
            const assets = await config.loadAssets(context, signal);
            if (bundle.disposed || signal.aborted) {
              assets.animator.dispose();
              throw new Error('Run assets cancelled');
            }
            // Retain before validation so normal initialization rollback owns the pack.
            bundle.assets = assets;
            validateVisualCoverage(assets, moves);
            bundle.residents = createResidentAssetStage(
              residentPlan,
              assets.animator,
              undefined,
              context.posePolicy,
            );
            await bundle.residents.prepare(signal);
            if (bundle.disposed || signal.aborted)
              throw new Error('Run assets cancelled');
            if (context.posePolicy?.mode === 'deterministic-pose-v1') {
              if (!bundle.prepareAnimation)
                throw new Error('Pose animation preparation is unavailable');
              bundle.prepareAnimation();
            }
            return assets.motions;
          },
          context.posePolicy?.mode === 'deterministic-pose-v1'
            ? {
                // B invokes this only after the sole loader has prepared residents.
                poseBindings: () => bundle.residents?.assets.poseBindings,
              }
            : {},
        ),
        assets: null,
        residents: null,
        ai: null,
        layout,
        disposed: false,
        prepareAnimation: null,
      };
      const core = createCore(context, {
        moves,
        // Preserve the prepared optional posture descriptor for Core in legacy
        // display mode too, without enabling deterministic display negotiation.
        catalog: {
          get: (id) => bundle.catalog.get(id),
          list: () => bundle.catalog.list(),
          get pose() {
            return bundle.catalog.pose ?? bundle.residents?.assets.poseBindings;
          },
        },
        world: config.world,
        enemyAi: (snapshot, spatial) =>
          bundle.ai?.decide(snapshot, spatial) ?? [],
      });
      // Capture Core-issued IDs before asynchronous loading; currentOpponentId is still null.
      const residentPlan = core.read();
      bundles.set(context.runId, bundle);
      return {
        ...core,
        dispose() {
          try {
            bundle.ai?.dispose();
          } finally {
            core.dispose();
            bundles.delete(context.runId);
          }
        },
      };
    },
    catalog(context) {
      const bundle = get(context.runId);
      return {
        ...bundle.catalog,
        get pose() {
          return bundle.catalog.pose;
        },
        dispose() {
          if (bundle.disposed) return;
          bundle.disposed = true;
          try {
            bundle.catalog.dispose();
          } finally {
            try {
              bundle.residents?.dispose();
            } finally {
              bundle.residents = null;
              const assets = bundle.assets;
              bundle.assets = null;
              assets?.animator.dispose();
            }
          }
        },
      };
    },
    spatial(context) {
      return createSceneAdapter(context, {
        root,
        layout: get(context.runId).layout,
        ...(options.createRenderer
          ? { createRenderer: options.createRenderer }
          : {}),
        onInterruption() {
          const snapshot = game.read();
          if (snapshot)
            game.dispatch({
              type: 'PauseRequested',
              runId: snapshot.runId,
              reason: 'interruption',
            });
        },
      });
    },
    animation(context) {
      const bundle = get(context.runId);
      let animation: ReturnType<typeof createActorAnimator<Object3D>> | null =
        null;
      const prepareAnimation = () => {
        if (!animation) {
          if (bundle.disposed || !bundle.residents)
            throw new Error('Animation assets have not prepared');
          animation = createActorAnimator(context, bundle.residents.assets);
        }
      };
      bundle.prepareAnimation = prepareAnimation;
      return {
        get poseProtocol() {
          return animation?.poseProtocol;
        },
        render(frame) {
          if (frame.snapshot.phase === 'loading') return;
          prepareAnimation();
          bundle.residents!.render(frame.snapshot, () =>
            animation!.render(frame),
          );
        },
        dispose() {
          bundle.prepareAnimation = null;
          animation?.dispose();
          animation = null;
        },
      };
    },
    ui: (context) => interfaceForApp().ui(context),
    input(context) {
      const bundle = get(context.runId);
      bundle.ai = createEnemyAi(context.movement);
      const input = interfaceForApp().input(context);
      return {
        ...input,
        setGate(gate) {
          if (!gate.enabled) bundle.ai?.dispose();
          input.setGate(gate);
        },
        releaseAll() {
          bundle.ai?.dispose();
          input.releaseAll();
        },
        dispose() {
          try {
            bundle.ai?.dispose();
          } finally {
            input.dispose();
          }
        },
      };
    },
  };
  game = createGame(factories, options);
  return game;
}

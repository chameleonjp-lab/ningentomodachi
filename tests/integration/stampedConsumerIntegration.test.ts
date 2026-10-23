// @vitest-environment jsdom
import { isStartupPoseEpoch } from '../../src/contracts';
/** Expected RED until actual B checkpoint2 is accepted. No poseProtocol mocks.
 * Real public host/Core/C/B factories + pinned visuals; ALL attack metadata is
 * the synthetic no-contact timing fixture. CPU renderer double, not WebGL proof. */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  Matrix4 as OracleMatrix4,
  Quaternion as OracleQuaternion,
  Vector3 as OracleVector3,
} from 'three';
import {
  type AcceptedGameConfiguration,
  createIntegratedGame,
} from '../../src/app/integratedGame';
import { createPinnedDerivedThreeAssetPack } from '../../src/assets';
import type {
  ActorColor,
  DurationMs,
  PoseClipBinding,
} from '../../src/contracts';
import * as SceneModule from '../../src/scene';
import {
  createSyntheticTimingCatalog,
  syntheticTimingMoves,
} from './fixtures/syntheticPoseCatalog';

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Required integration value unavailable');
  return value;
}

function setup() {
  const root = document.createElement('main');
  document.body.append(root);
  const lifecycle: string[] = [];
  const seeks: Array<{
    color: ActorColor;
    binding: PoseClipBinding;
    time: DurationMs;
  }> = [];
  const layout = SceneModule.createParisStreetLayout();
  const createScene = SceneModule.createSceneAdapter;
  // Observation only: actual C capabilities, binding, stepping and candidates
  // are untouched. This is not a synthetic pose producer or capability claim.
  const step = vi.fn();
  const committedPhases: string[] = [];
  const sceneSpy = vi
    .spyOn(SceneModule, 'createSceneAdapter')
    .mockImplementation((...args) => {
      const actual = createScene(...args);
      return {
        ...actual,
        commit(output, viewport) {
          committedPhases.push(output.snapshot.phase);
          return actual.commit(output, viewport);
        },
        step(request, catalog) {
          const result = actual.step(request, catalog);
          step(result);
          expect(result.candidates).toEqual([]);
          return result;
        },
      };
    });
  const configuration: AcceptedGameConfiguration = {
    moves: syntheticTimingMoves(),
    layout,
    world: {
      vehicles: layout.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
      })),
      objects: layout.objects.map((o) => ({
        objectId: o.objectId,
        durability: 100,
      })),
    },
    async loadAssets(context, signal) {
      const pack = await createPinnedDerivedThreeAssetPack({
        derivedBytes: new Uint8Array(
          readFileSync('public/game-assets/android/derived-pack-v1.glb'),
        ),
        artifactBytes: new Uint8Array(
          readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
        ),
        signal,
      });
      try {
        const timing = createSyntheticTimingCatalog(pack);
        const bindings = required(pack.poseBindings);
        return {
          motions: timing.motions,
          animator: {
            poseBindings: bindings,
            locomotionClips: bindings.locomotion,
            clipDuration: (id) => pack.clipDuration(id),
            create(color) {
              lifecycle.push(`create:${context.runId}:${color}`);
              const rig = pack.create(color);
              if (!rig.seekPose || !rig.seekDefeat) {
                rig.dispose();
                throw new Error('Actual pinned driver capability missing');
              }
              const seekPose = rig.seekPose.bind(rig);
              return {
                ...rig,
                seekPose(binding, time) {
                  seeks.push({ color, binding, time });
                  seekPose(binding, time);
                },
                dispose() {
                  lifecycle.push(
                    `dispose:${context.runId}:${color}:${rig.node.parent === null ? 'detached' : 'mounted'}`,
                  );
                  rig.dispose();
                },
              };
            },
            dispose() {
              lifecycle.push(`pack:${context.runId}`);
              pack.dispose();
            },
          },
        };
      } catch (error) {
        pack.dispose();
        throw error;
      }
    },
  };
  const draw = vi.fn();
  const game = createIntegratedGame(root, {
    sessionId: 'actual-stamped-integration',
    seed: 1,
    stepMs: 10,
    posePolicy: { version: 1, mode: 'deterministic-pose-v1' },
    viewport: {
      widthCssPx: 400,
      heightCssPx: 800,
      offsetLeftCssPx: 0,
      offsetTopCssPx: 0,
      devicePixelRatio: 1,
      safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    configuration,
    createRenderer: () => ({
      domElement: document.createElement('canvas'),
      render: draw,
      setSize() {},
      setPixelRatio() {},
      dispose() {},
    }),
  });
  return {
    game,
    root,
    lifecycle,
    seeks,
    step,
    committedPhases,
    draw,
    dispose() {
      game.dispose();
      sceneSpy.mockRestore();
      root.remove();
    },
  };
}

test('actual stamped consumer qualifies before ready, owns only required rigs and uses authoritative attack clocks', async () => {
  const h = setup();
  const { game, root, lifecycle, seeks, step, committedPhases, draw } = h;
  try {
    try {
      await game.start();
    } catch (error) {
      // Preserve a precise pre-consumer RED, not a loading-fixture accident or
      // transient ready state. Remove no guard when the real consumer arrives.
      expect(String(error)).toContain(
        'Required pose protocol capability is unavailable',
      );
      expect(committedPhases).toContain('loading');
      expect(committedPhases).not.toContain('ready');
      expect(seeks).toEqual([]);
      throw error;
    }
    const ready = required(game.read());
    expect(ready.phase).toBe('ready');
    expect(lifecycle).toEqual([
      `create:${ready.runId}:white`,
      `create:${ready.runId}:blue`,
    ]);
    expect(seeks.some((seek) => seek.color === 'white')).toBe(true);
    expect(seeks.some((seek) => seek.color === 'blue')).toBe(true);
    expect(draw).toHaveBeenCalled();
    game.dispatch({ type: 'StartRequested', runId: ready.runId });
    required(
      Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent === 'パンチ',
      ),
    ).click();
    game.advance(20);
    const running = required(game.read());
    const player = required(
      running.actors.find((actor) => actor.color === 'white'),
    );
    const attack = required(player.attack);
    const latest = required(
      seeks.filter((seek) => seek.color === 'white').at(-1),
    );
    expect(latest.binding.clipId).toBe(attack.clipId);
    expect(latest.time).toBe(running.clocks.gameTimeMs - attack.startedAt);
    expect(step).toHaveBeenCalled();
    expect(running.actors.map((actor) => actor.hp)).toEqual([
      500, 500, 500, 500, 700,
    ]);
    game.dispatch({
      type: 'PauseRequested',
      runId: ready.runId,
      reason: 'settings',
    });
    game.advance(1000);
    expect(game.read()?.clocks.gameTimeMs).toBe(running.clocks.gameTimeMs);
    game.dispatch({
      type: 'ResumeRequested',
      runId: ready.runId,
      reason: 'settings',
    });
    game.advance(10);
    expect(game.lastError()).toBeNull();
    game.dispose();
    expect(lifecycle.slice(-3)).toEqual([
      `dispose:${ready.runId}:white:detached`,
      `dispose:${ready.runId}:blue:detached`,
      `pack:${ready.runId}`,
    ]);
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
  } finally {
    h.dispose();
  }
}, 30000);

test('public restart detaches and releases the prior real rigs and pack before successor allocation', async () => {
  const h = setup();
  try {
    await h.game.start();
    const first = required(h.game.read());
    expect(first.phase).toBe('ready');
    await h.game.restart();
    const second = required(h.game.read());
    expect(second.phase).toBe('ready');
    expect(second.runId).not.toBe(first.runId);
    expect(h.lifecycle).toEqual([
      `create:${first.runId}:white`,
      `create:${first.runId}:blue`,
      `dispose:${first.runId}:white:detached`,
      `dispose:${first.runId}:blue:detached`,
      `pack:${first.runId}`,
      `create:${second.runId}:white`,
      `create:${second.runId}:blue`,
    ]);
    h.game.dispatch({ type: 'StartRequested', runId: first.runId });
    expect(h.game.read()?.runId).toBe(second.runId);
    expect(h.game.read()?.phase).toBe('ready');
    h.game.dispose();
    h.game.dispose();
    expect(h.lifecycle.slice(-3)).toEqual([
      `dispose:${second.runId}:white:detached`,
      `dispose:${second.runId}:blue:detached`,
      `pack:${second.runId}`,
    ]);
    expect(
      h.lifecycle.filter((event) => event.startsWith('create:')),
    ).toHaveLength(4);
    expect(
      h.lifecycle.filter((event) => event.startsWith('dispose:')),
    ).toHaveLength(4);
    expect(
      h.lifecycle.filter((event) => event.startsWith('pack:')),
    ).toHaveLength(2);
    expect(h.root.querySelectorAll('canvas')).toHaveLength(0);
  } finally {
    h.dispose();
  }
}, 30000);

/** Source-free timetable only: actual Core/C; no pack, rig, animator render or
 * numeric provider. Authentic selected bindings copied from the audited receipt
 * d5628fa468e9775b4e405804659dff6833eb1f9f6a6df20a2481a84128071fd5. */
async function preparePublicBTimetable(recoveryEnabled = true) {
  const { createCore } = await import('../../src/core');
  const { createSpatialEngine } = await import(
    '../../src/world/spatial-engine'
  );
  const { deathClipSeconds } = await import('../../src/assets/deathAnimation');
  const { clipId, durationMs, gameTimeMs, isRecoveryPoseEpoch } = await import(
    '../../src/contracts'
  );
  const { fixtureCatalog, run, attack, reference, envelope } = await import(
    '../core/fixtures/scenarios'
  );
  const { viewport } = await import('../world/fixtures');
  const authentic = [
    {
      clipId: clipId('KungFuStraight'),
      durationMs: durationMs(1355.555534362793),
      sourceBindingId:
        'pose-v1:aa246050d15512e6b6407bb4d6aeb9e8e6e90af604bcdc78745a169593e76d56',
    },
    {
      clipId: clipId('Idle'),
      durationMs: durationMs(2022.2222805023193),
      sourceBindingId:
        'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
    },
  ] as const;
  const synthetic = fixtureCatalog(150);
  const definitions = synthetic.catalog.list().map((motion) => {
    const selected = motion.clipId === 'punch:0';
    const end = selected ? authentic[0].durationMs : 300;
    return {
      ...motion,
      clipId: selected ? authentic[0].clipId : motion.clipId,
      durationMs: durationMs(end),
      impacts: motion.impacts.map((v) => ({ ...v, endMs: durationMs(end) })),
      rootCurve: motion.rootCurve.map((v, i) => ({
        ...v,
        atMs: durationMs(i ? end : 0),
      })),
    };
  });
  const moves = {
    ...synthetic.moves,
    white: { ...synthetic.moves.white, punches: [authentic[0].clipId] },
    blue: {
      ...synthetic.moves.blue,
      punches: ['punch:1', 'punch:2', 'punch:3', 'punch:4'].map(clipId),
    },
  };
  const motions: import('../../src/contracts').MotionCatalogPort = {
    prepare: async () => {},
    dispose() {},
    list: () => definitions,
    get: (id) => definitions.find((d) => d.clipId === id),
    sampleMotion: () => undefined,
  };
  const recovery = {
    version: 1,
    protocol: 'kungfu-recovery-epoch-diagnostic-v1',
    durationMs: durationMs(150),
    fixedLiftSign: 1,
  } as const;
  const core = createCore(
    { runId: run, seed: 1 },
    { catalog: motions, moves, enemyAi: false },
  );
  const spatial = createSpatialEngine(
    run,
    { ...SceneModule.createParisStreetLayout(), vehicles: [], objects: [] },
    {
      version: 1,
      mode: 'deterministic-pose-v1',
      ...(recoveryEnabled ? { recovery } : {}),
    },
  );
  const bindings: import('../../src/contracts').PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'dry-run-selected-authentic-auxiliary-synthetic',
    clips: [
      ...authentic,
      ...['walk', 'run', 'jump'].map((id) => ({
        clipId: clipId(id),
        durationMs: durationMs(100),
        sourceBindingId: 'synthetic-unused:' + id,
      })),
      ...definitions
        .filter((d) => d.clipId !== 'KungFuStraight')
        .map((d) => ({
          clipId: d.clipId,
          durationMs: d.durationMs,
          sourceBindingId: 'synthetic-unrendered:' + d.clipId,
        })),
    ],
    locomotion: {
      idle: authentic[1].clipId,
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  type Frame = import('../../src/contracts').CommittedFrame;
  let frame!: Frame;
  const frames: Frame[] = [];
  const trace: unknown[] = [],
    rows: unknown[] = [];
  const actualBQueries = 0,
    actualHQueries = 0;
  const commit = (output = core.drain()) => {
    frame = { ...output, spatial: spatial.commit(output), viewport };
    return frame;
  };
  const white = () => core.read().actors[0]!;
  const perform = (
    dt: number,
    candidates: readonly import('../../src/contracts').SpatialCandidate[] = [],
  ) => {
    core.present(durationMs(dt));
    const request = core.beginStep({ durationMs: durationMs(dt) });
    const result = spatial.step(request, motions);
    expect(result.candidates).toEqual([]);
    const output = core.completeStep({ ...result, candidates });
    trace.push({
      candidates,
      requestAttacks: request.snapshot.actors.map((actor) => ({
        actorId: actor.actorId,
        attack: actor.attack,
      })),
      clocks: output.snapshot.clocks,
      hp: output.snapshot.actors.map((a) => a.hp),
      events: output.events,
    });
    return commit(output);
  };
  const advance = (elapsed: number) => {
    for (let remaining = elapsed; remaining > 0; ) {
      const dt = Math.min(20, remaining);
      perform(dt);
      remaining -= dt;
    }
  };
  const requestAttack = (color: ActorColor = 'white') => {
    attack(core, color);
    commit();
    return reference(core, color);
  };
  const capture = (name: string, selected: Frame = frame) => {
    frames.push(selected);
    const actors = selected.snapshot.residentActorIds!.map((id) => {
      const state = required(
        selected.snapshot.actors.find((a) => a.actorId === id),
      );
      const pose = required(
        required(selected.spatial.actors.find((a) => a.actorId === id)).pose,
      );
      const epochs =
        pose.kind === 'recovery' || pose.kind === 'startup'
          ? [pose.epoch.outgoing, pose.epoch.destination]
          : pose.kind === 'living'
            ? [pose.living]
            : isRecoveryPoseEpoch(pose.entry) || isStartupPoseEpoch(pose.entry)
              ? [pose.entry.outgoing, pose.entry.destination]
              : [pose.entry];
      for (const epoch of epochs)
        expect(epoch.binding).toEqual(
          required(
            authentic.find(
              (binding) => binding.clipId === epoch.binding.clipId,
            ),
          ),
        );
      const composite =
        pose.kind === 'recovery' ||
        pose.kind === 'startup' ||
        (pose.kind === 'defeat' &&
          'kind' in pose.entry &&
          pose.entry.kind === 'recovery');
      const bReserved =
        pose.kind === 'defeat' ? (composite ? 7 : 5) : composite ? 4 : 2;
      const hReserved = composite ? 2 : 1;
      const deathMs =
        pose.kind === 'defeat'
          ? deathClipSeconds(
              required(state.defeatPresentation),
              selected.snapshot.clocks.presentationTimeMs,
            ) * 1000
          : undefined;
      if (deathMs !== undefined) expect(deathMs).toBe(0.25);
      return {
        actorId: id,
        color: state.color,
        pose,
        bReserved,
        hReserved,
        deathMs,
        hObservation:
          pose.kind === 'defeat'
            ? 'ENTRY-only; no moving-death head parity'
            : 'current canonical/recovery parity proposed',
      };
    });
    const record = {
      name,
      revision: selected.snapshot.revision,
      clocks: selected.snapshot.clocks,
      actors,
      bReserved: actors.reduce((n, a) => n + a.bReserved, 0),
      hReserved: actors.reduce((n, a) => n + a.hReserved, 0),
    };
    rows.push(record);
    return selected;
  };
  let t0 = 0;
  let failure: unknown;
  try {
    commit();
    spatial.poseProtocol!.bindPreparedCatalog(bindings);
    core.handle({ type: 'AssetsReady', runId: run });
    commit();
    core.handle({ type: 'StartRequested', runId: run });
    commit();
    for (let i = 0; i < 3; i++) {
      advance(500);
      const source = requestAttack('blue'),
        from = core.read().clocks.gameTimeMs,
        at = from + 1;
      const killed = perform(20, [
        {
          ...envelope(at, 'prime:' + i),
          interval: { from, to: gameTimeMs(from + 20) },
          kind: 'body-hit',
          source,
          targetActorId: white().actorId,
        },
      ]);
      expect(killed.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
        1,
      );
      expect(white().hp).toBe(500 - (i + 1) * 150);
    }
    advance(500);
    t0 = core.read().clocks.gameTimeMs;
    expect(t0).toBe(2060);
    requestAttack();
    advance(1340);
    capture('1 attack before natural end');
    advance(20);
    capture('2 first recovery');
    advance(80);
    const retained = capture('3 recovery interior');
    advance(80);
    capture('4 destination original clock');
    const unchanged = frame;
    capture('5 replay retained row3', retained); // No Core/C rewind or commit.
    expect(frame).toBe(unchanged);
    requestAttack();
    expect(white().attack?.startedAt).toBe(t0 + 1520);
    advance(1360);
    requestAttack();
    expect(white().attack?.startedAt).toBe(t0 + 2880);
    capture('6 new attack interrupts second recovery');
    advance(1360);
    const source = requestAttack('blue');
    const from = core.read().clocks.gameTimeMs,
      at = t0 + 4259;
    expect(from).toBe(t0 + 4240);
    const last = perform(20, [
      {
        ...envelope(at, 'fatal-inside-step'),
        interval: { from, to: gameTimeMs(from + 20) },
        kind: 'body-hit',
        source,
        targetActorId: white().actorId,
      },
    ]);
    expect(last.snapshot.phase).toBe('terminal');
    expect(last.events.find((e) => e.type === 'ActorDefeated')?.at).toBe(at);
    expect(last.snapshot.clocks.gameTimeMs).toBe(at);
    expect(last.snapshot.clocks.presentationTimeMs).toBe(t0 + 4260);
    expect(last.snapshot.clocks.activeRealTimeMs).toBe(t0 + 4260);
    expect(white().defeatPresentation?.startedAt).toBe(at);
    const deathPose = required(
      last.spatial.actors.find((actor) => actor.actorId === white().actorId)
        ?.pose,
    );
    expect(deathPose).toMatchObject({
      kind: 'defeat',
      entryAt: at,
      defeatStartedAt: at,
      ...(recoveryEnabled
        ? {
            entry: {
              kind: 'recovery',
              startMs: t0 + 2880 + authentic[0].durationMs,
            },
          }
        : {}),
    });
    // Equal numeric entry/death-start values in this no-pause fixture are still
    // independently sourced game-time and presentation-time fields.
    capture('7 inside-step death; H ENTRY diagnostic only');
    const typed = rows as { bReserved: number; hReserved: number }[];
    if (recoveryEnabled)
      expect(typed.reduce((n, r) => n + r.bReserved, 0)).toBe(39);
    if (recoveryEnabled)
      expect(typed.reduce((n, r) => n + r.hReserved, 0)).toBe(18);
    expect(actualBQueries + actualHQueries).toBe(0);
    return { frames, rows, trace, bindings, recovery, run, viewport };
  } catch (error) {
    failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : String(error);
    throw error;
  } finally {
    core.dispose();
    spatial.dispose();
    const fs = await import('node:fs'),
      path = await import('node:path');
    fs.mkdirSync('reports', { recursive: true });
    const directory = fs.mkdtempSync(path.resolve('reports/public-b-dry-run-'));
    fs.writeFileSync(
      path.join(directory, 'timetable.json'),
      JSON.stringify(
        {
          sourceFree: true,
          failure,
          cleanupComplete: true,
          authenticBindingReceipt:
            'd5628fa468e9775b4e405804659dff6833eb1f9f6a6df20a2481a84128071fd5',
          t0,
          rows,
          trace,
          actualBQueries,
          actualHQueries,
          plannedB: 39,
          plannedHReservations: 18,
          plannedTotal: 57,
          hardCap: 64,
        },
        null,
        2,
      ) + '\n',
      { encoding: 'utf8', flag: 'wx' },
    );
  }
}

test('source-free public B retained-frame timetable and death clock admission', async () => {
  const on = await preparePublicBTimetable();
  const off = await preparePublicBTimetable(false);
  expect(on.trace).toEqual(off.trace);
  expect(on.frames.map((f) => f.snapshot)).toEqual(
    off.frames.map((f) => f.snapshot),
  );
  expect(
    on.frames.map((f) =>
      f.spatial.actors.map(({ pose: _pose, ...physical }) => physical),
    ),
  ).toEqual(
    off.frames.map((f) =>
      f.spatial.actors.map(({ pose: _pose, ...physical }) => physical),
    ),
  );
}, 30_000);

// Normal-CI correctness regression. Source I/O remains inside the test callback.
test('public B consumes seven actual C retained frames within 57 source units', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync('reports', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('reports/public-b-source-'));
  const records: unknown[] = [];
  const emit = (marker: string, value: unknown) =>
    records.push({ marker, value });
  let primary: unknown,
    failed = false,
    cleanupComplete = false;
  const cleanups: Array<() => void> = [];
  let bAttempted = 0,
    bCompleted = 0,
    hReserved = 0,
    hCompleted = 0;
  let fullRigs = 0,
    peakRigs = 0,
    staged = 0,
    peakStaged = 0;
  try {
    const timetable = await preparePublicBTimetable();
    const baseline = await preparePublicBTimetable(false);
    expect(timetable.trace).toEqual(baseline.trace);
    expect(timetable.frames.map((f) => f.snapshot)).toEqual(
      baseline.frames.map((f) => f.snapshot),
    );
    expect(
      timetable.frames.map((f) =>
        f.spatial.actors.map(({ pose: _pose, ...physical }) => physical),
      ),
    ).toEqual(
      baseline.frames.map((f) =>
        f.spatial.actors.map(({ pose: _pose, ...physical }) => physical),
      ),
    );
    emit('ADMISSION', {
      plannedB: 39,
      hReservations: 18,
      total: 57,
      hardCap: 64,
      table: timetable.rows,
      trace: timetable.trace,
      scope:
        'selected C to authentic B only; auxiliary Core timing synthetic; no whole catalog readiness',
      deathHeadOracle: 'ENTRY only, not current moving death parity',
    });
    const { AnimationMixer, Group, Matrix4, SkinnedMesh } = await import(
      'three'
    );
    const { createActorAnimator } = await import(
      '../../src/assets/actorAnimator'
    );
    const { preparePinnedSourceHead } = await import(
      '../../src/assets/headSurface'
    );
    const { isRecoveryPoseEpoch } = await import('../../src/contracts');
    const { loadKungFuStraightDiagnostics, KUNG_FU_STRAIGHT_SOURCE_PINS } =
      await import('../../tools/assets/kungFuStraightDiagnostic');
    const entries = loadKungFuStraightDiagnostics({
      sourceBytes: fs.readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.sourcePath),
      manifestBytes: fs.readFileSync(KUNG_FU_STRAIGHT_SOURCE_PINS.manifestPath),
      recipeBytes: fs.readFileSync(
        'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
      ),
      candidateBytes: fs.readFileSync(
        'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
      ),
    });
    const rootPolicies = entries.map((e) => e.rootPolicy);
    const derivedBytes = fs.readFileSync(
      'public/game-assets/android/derived-pack-v1.glb',
    );
    const artifactBytes = fs.readFileSync(
      'public/game-assets/android/runtime-artifact-v1.json',
    );
    const started = performance.now(),
      controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    cleanups.push(() => {
      clearTimeout(timer);
      controller.abort();
    });
    const pack = await createPinnedDerivedThreeAssetPack({
      derivedBytes,
      artifactBytes,
      rootPolicies,
      signal: controller.signal,
    });
    cleanups.push(() => pack.dispose());
    const numeric = await preparePinnedSourceHead({
      derivedBytes,
      rootPolicies,
      signal: controller.signal,
    });
    cleanups.push(() => numeric.dispose());
    clearTimeout(timer);
    expect(performance.now() - started).toBeLessThan(30_000);
    const descriptor = required(pack.poseBindings);
    expect(pack.recoveryCapability).toEqual(timetable.recovery);
    for (const selected of timetable.frames)
      for (const actor of selected.spatial.actors) {
        if (!selected.snapshot.residentActorIds?.includes(actor.actorId))
          continue;
        const pose = required(actor.pose);
        const epoch =
          pose.kind === 'defeat'
            ? pose.entry
            : pose.kind === 'recovery' || pose.kind === 'startup'
              ? pose.epoch
              : pose.living;
        for (const stamp of isRecoveryPoseEpoch(epoch) ||
        isStartupPoseEpoch(epoch)
          ? [epoch.outgoing, epoch.destination]
          : [epoch]) {
          expect(['KungFuStraight', 'Idle']).toContain(stamp.binding.clipId);
          expect(stamp.binding).toEqual(
            required(
              descriptor.clips.find((b) => b.clipId === stamp.binding.clipId),
            ),
          );
          expect(pack.clipDuration(stamp.binding.clipId)).toBe(
            stamp.binding.durationMs,
          );
        }
      }
    emit('AUTHENTIC_BINDINGS', {
      descriptor,
      rootPolicies,
      preparationMs: performance.now() - started,
    });
    const budget = () => {
      if (bAttempted + hReserved > 64)
        throw Error('Hard64 source cap exceeded');
    };
    const originalUpdate = AnimationMixer.prototype.update;
    const spy = vi
      .spyOn(AnimationMixer.prototype, 'update')
      .mockImplementation(function (
        this: InstanceType<typeof AnimationMixer>,
        delta: number,
      ) {
        bAttempted++;
        budget();
        const result = originalUpdate.call(this, delta);
        bCompleted++;
        return result;
      });
    cleanups.push(() => spy.mockRestore());
    type Rig = ReturnType<typeof pack.create>;
    type Driver = NonNullable<Rig['poseFrame']>;
    const rigs = new Map<string, Rig>();
    const parents = new Map<string, InstanceType<typeof Group>>();
    const requests: import('../../src/assets/poseFramePreparation').PoseFrameRequest[] =
      [];
    const supports: unknown[] = [];
    const wrapped = new Map<Driver, Driver>();
    const wrapDriver = (driver: Driver): Driver => {
      const found = wrapped.get(driver);
      if (found) return found;
      const observer: Driver = {
        capability: driver.capability,
        prepare(request) {
          requests.push(request);
          emit('PREPARE_REQUEST', request);
          const begin = performance.now();
          try {
            return driver.prepare(request);
          } finally {
            emit('PRIVATE_PREPARE_MS', {
              actorId: request.actorId,
              kind: request.kind,
              elapsedMs: performance.now() - begin,
            });
          }
        },
        apply(command) {
          driver.apply(command);
        },
        dispose() {
          driver.dispose();
        },
      };
      wrapped.set(driver, observer);
      return observer;
    };
    const animator = createActorAnimator<import('three').Object3D>(
      {
        runId: timetable.run,
        seed: 1,
        posePolicy: {
          version: 1,
          mode: 'deterministic-pose-v1',
          recovery: timetable.recovery,
        },
        viewport: {
          read: () => timetable.viewport,
          subscribe: () => () => {},
        },
        renderHost: {
          runId: timetable.run,
          mountActor({ actorId, node }) {
            const parent = new Group();
            parent.position.set(0.7, 2, -0.8);
            parent.rotation.y = 0.43;
            parent.add(node);
            parent.updateMatrixWorld(true);
            parents.set(actorId, parent);
            return () => {
              node.removeFromParent();
              parents.delete(actorId);
            };
          },
          publishDefeatPoseSupport(observation) {
            supports.push(observation);
            emit('SUPPORT', observation);
            return true;
          },
        },
      },
      {
        poseBindings: descriptor,
        recoveryCapability: required(pack.recoveryCapability),
        locomotionClips: descriptor.locomotion,
        clipDuration: pack.clipDuration,
        create() {
          throw Error('Opt-in must use CPU stage');
        },
        stageActor(color) {
          const handle = required(pack.stageActor)(color);
          staged++;
          peakStaged = Math.max(peakStaged, staged);
          let closed = false,
            transferred = false;
          const driver = wrapDriver(handle.poseFrame);
          return {
            poseFrame: driver,
            materialize() {
              let id: string | undefined,
                counted = false;
              const release = (rig: Rig) => {
                if (closed) return;
                closed = true;
                if (id !== undefined) rigs.delete(id);
                if (counted) {
                  fullRigs--;
                  counted = false;
                }
                rig.dispose();
              };
              return transferMaterialized(
                () => handle.materialize(),
                (rig) => {
                  // The helper owns the returned rig before any check/getter.
                  transferred = true;
                  staged--;
                  fullRigs++;
                  counted = true;
                  peakRigs = Math.max(peakRigs, fullRigs);
                  expect(peakRigs).toBeLessThanOrEqual(2);
                  const actor = required(
                    timetable.frames[0],
                  ).snapshot.actors.find((a) => a.color === color);
                  id = required(actor).actorId;
                  rigs.set(id, rig);
                  return {
                    ...rig,
                    poseFrame: driver,
                    dispose() {
                      release(rig);
                    },
                  };
                },
                release,
              );
            },
            dispose() {
              if (closed || transferred) return;
              closed = true;
              staged--;
              handle.dispose();
            },
          };
        },
      },
    );
    cleanups.push(() => animator.dispose());
    const expectedB = [4, 6, 6, 4, 6, 4, 9],
      expectedH = [2, 3, 3, 2, 3, 2, 3];
    const replayLocals = new Map<string, unknown>();
    for (let row = 0; row < timetable.frames.length; row++) {
      const frame = required(timetable.frames[row]);
      const bb = bAttempted,
        hh = hReserved,
        requestStart = requests.length;
      const begin = performance.now();
      animator.render(frame);
      expect(fullRigs).toBe(2);
      expect(staged).toBe(0);
      const currentRequests = requests.slice(requestStart);
      expect(currentRequests).toHaveLength(2);
      for (const actor of frame.spatial.actors) {
        if (!frame.snapshot.residentActorIds?.includes(actor.actorId)) continue;
        const rig = required(rigs.get(actor.actorId)),
          parent = required(parents.get(actor.actorId));
        const physical = {
          p: parent.position.toArray(),
          q: parent.quaternion.toArray(),
          s: parent.scale.toArray(),
        };
        expect(physical.p).toEqual([0.7, 2, -0.8]);
        expect(physical.s).toEqual([1, 1, 1]);
        const fixed = new Group();
        fixed.rotation.y = 0.43;
        expect(physical.q).toEqual(fixed.quaternion.toArray());
        parent.updateMatrixWorld(true);
        const meshes: InstanceType<typeof SkinnedMesh>[] = [],
          nodes: unknown[] = [],
          nonfinite: unknown[] = [];
        rig.node.traverse((part) => {
          if (part instanceof SkinnedMesh) {
            meshes.push(part);
            part.skeleton.update();
          }
          for (const [field, values] of Object.entries({
            t: part.position.toArray(),
            q: part.quaternion.toArray(),
            s: part.scale.toArray(),
            world: part.matrixWorld.toArray(),
          })) {
            values.forEach((value, component) => {
              if (!Number.isFinite(value))
                nonfinite.push({
                  index: nodes.length,
                  name: part.name,
                  field,
                  component,
                  value: String(value),
                });
            });
          }
          nodes.push({
            index: nodes.length,
            name: part.name,
            t: part.position.toArray(),
            q: part.quaternion.toArray(),
            s: part.scale.toArray(),
            world: part.matrixWorld.toArray(),
          });
        });
        const exactLocals = nodes.map((node) => {
          const { index, name, t, q, s } = node as {
            index: number;
            name: string;
            t: number[];
            q: number[];
            s: number[];
          };
          return { index, name, t, q, s };
        });
        emit('APPLIED_RAW', {
          row: row + 1,
          actorId: actor.actorId,
          nodes,
          physical,
          nonfinite,
        });
        expect(nonfinite).toEqual([]);
        if (row === 2) replayLocals.set(actor.actorId, exactLocals);
        if (row === 4)
          expect(exactLocals).toEqual(
            required(replayLocals.get(actor.actorId)),
          );

        const pose = required(actor.pose),
          request = required(
            currentRequests.find((r) => r.actorId === actor.actorId),
          );
        if (pose.kind === 'defeat') {
          expect(request.kind).toBe('defeat');
          if (request.kind !== 'defeat') throw Error('Wrong request kind');
          expect(request.input.entry).toEqual({
            kind: 'recovery',
            epoch: pose.entry,
            at: pose.entryAt,
            sampleSide: 'left',
          });
          expect(request.input.defeatStartedAt).toBe(pose.defeatStartedAt);
          expect(request.input.deathClipTime).toBe(0.25);
          hReserved += 2;
          budget();
          const entry = numeric.epochDiagnostic.entry(pose);
          hCompleted++;
          expect(entry.kind).toBe('transform');
          emit('H_ENTRY_ONLY', { row: row + 1, entry });
          const support = required(rig.defeatPoseSupport?.());
          expect(Number.isFinite(support.entryLocalMinY)).toBe(true);
          expect(
            Object.values(support.currentLocalBounds.min).every(
              Number.isFinite,
            ),
          ).toBe(true);
          expect(
            Object.values(support.currentLocalBounds.max).every(
              Number.isFinite,
            ),
          ).toBe(true);
          emit('CURRENT_DEATH_SUPPORT', support); // Not an entry/current head equality claim.
        } else {
          const epoch =
            pose.kind === 'recovery' || pose.kind === 'startup'
              ? pose.epoch
              : pose.living;
          expect(request).toMatchObject({
            kind: 'living',
            epoch,
            at: frame.snapshot.clocks.gameTimeMs,
            side: 'right',
          });
          hReserved +=
            isRecoveryPoseEpoch(epoch) || isStartupPoseEpoch(epoch) ? 2 : 1;
          budget();
          const sample = numeric.epochDiagnostic.point(
            epoch,
            frame.snapshot.clocks.gameTimeMs,
            'right',
          );
          hCompleted++;
          emit('H_CURRENT', { row: row + 1, actorId: actor.actorId, sample });
          if (sample.kind !== 'transform')
            throw Error(`Unsupported independent H: ${sample.reason}`);
          const mesh = required(meshes[numeric.descriptor.meshIndex]);
          const bone = required(
            mesh.skeleton.bones[numeric.descriptor.headJointIndex],
          );
          const adjustment = new Matrix4()
            .fromArray(numeric.descriptor.headAttachmentAtBind)
            .invert()
            .multiply(
              new Matrix4().fromArray(
                numeric.descriptor.referenceToActorAtBind,
              ),
            );
          const displayed = new Matrix4()
            .copy(rig.node.matrixWorld)
            .invert()
            .multiply(bone.matrixWorld)
            .multiply(adjustment)
            .toArray();
          displayed.forEach((v, i) => {
            expect(Math.abs(v - required(sample.matrix[i]))).toBeLessThan(
              1e-10,
            );
          });
        }
      }
      emit('ROW', {
        row: row + 1,
        b: bAttempted - bb,
        hReserved: hReserved - hh,
        elapsedMs: performance.now() - begin,
      });
      expect(bAttempted - bb).toBe(expectedB[row]);
      expect(hReserved - hh).toBe(expectedH[row]);
    }
    expect(bAttempted).toBe(39);
    expect(bCompleted).toBe(39);
    expect(hReserved).toBe(18);
    expect(hCompleted).toBe(14);
    expect(peakRigs).toBe(2);
    expect(peakStaged).toBe(2);
    expect(supports.length).toBeGreaterThan(0);
    const artifact = JSON.parse(artifactBytes.toString('utf8')) as {
      support: {
        stats: { vertices: number; retainedVertices: number };
        meshes: {
          vertexCount: number;
          groups: {
            joints: number[];
            weights: number[];
            indices: number[];
          }[];
        }[];
      };
    };
    const supportNumericBytes = artifact.support.meshes.reduce(
      (sum, mesh) =>
        sum +
        (11 * mesh.vertexCount +
          mesh.groups.reduce(
            (n, g) =>
              n + g.joints.length + g.weights.length + g.indices.length * 3,
            0,
          )) *
          8,
      0,
    );
    const graphCosts = [...rigs].map(([actorId, rig]) => {
      let nodes = 0,
        vertices = 0;
      rig.node.traverse((node) => {
        nodes++;
        if (node instanceof SkinnedMesh)
          vertices += node.geometry.getAttribute('position').count;
      });
      expect(vertices).toBe(artifact.support.stats.vertices);
      return {
        actorId,
        nodes,
        vertices,
        privateTransformNumericBytes: nodes * 336,
        detachedFrameTRSNumericBytes: (nodes - 1) * 80,
      };
    });
    emit('RESOURCE_ACCOUNTING', {
      packs: 1,
      fullRigs,
      peakRigs,
      peakStaged,
      graphCosts,
      sharedPerPackSupportNumericBytes: supportNumericBytes,
      retainedSupportPoints: artifact.support.stats.retainedVertices,
      offlineCacheMaxKeys: 4,
      cacheRetainedBeyondActorDisposal: true,
      processHeapUsedBytes: process.memoryUsage().heapUsed,
      heapIsUnattributed: true,
      framePerformanceAccepted: false,
    });
    emit('PASS', { selectedFrames: 7, publicRenders: 7 });
  } catch (error) {
    failed = true;
    primary = error;
    emit('PRIMARY_ERROR', String(error));
  } finally {
    const errors: string[] = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(String(error));
      }
    }
    cleanupComplete = errors.length === 0 && fullRigs === 0 && staged === 0;
    records.push({
      marker: 'TERMINAL',
      value: {
        failed,
        cleanupComplete,
        errors,
        bAttempted,
        bCompleted,
        hReserved,
        hCompleted,
        fullRigs,
        peakRigs,
        staged,
        peakStaged,
      },
    });
    try {
      fs.writeFileSync(
        path.join(directory, 'public-b-receipt.json'),
        JSON.stringify(records, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      } else {
        try {
          process.stderr.write(`Receipt write failed: ${String(error)}\n`);
        } catch {}
      }
    }
    if (!failed && !cleanupComplete) {
      failed = true;
      primary = Error(`Cleanup failed: ${errors.join('; ')}`);
    }
  }
  if (failed) throw primary;
}, 60_000);

test('source-free public B wrapper releases a materialized rig on post-acquire rejection', () => {
  const primary = Error('post-materialize rejection');
  for (const cleanupThrows of [false, true]) {
    const rig = {
      dispose: vi.fn(() => {
        if (cleanupThrows) throw Error('cleanup failure');
      }),
    };
    expect(() =>
      transferMaterialized(
        () => rig,
        () => {
          throw primary;
        },
        (value) => value.dispose(),
      ),
    ).toThrow(primary);
    expect(rig.dispose).toHaveBeenCalledTimes(1);
  }
});

test('source-free public B wrapper transfers successful ownership without premature disposal', () => {
  const rig = { dispose: vi.fn() };
  expect(
    transferMaterialized(
      () => rig,
      (value) => value,
      (value) => value.dispose(),
    ),
  ).toBe(rig);
  expect(rig.dispose).not.toHaveBeenCalled();
});

function transferMaterialized<T, U>(
  acquire: () => T,
  complete: (value: T) => U,
  release: (value: T) => void,
): U {
  const owned = acquire();
  try {
    return complete(owned);
  } catch (primary) {
    try {
      release(owned);
    } catch {
      /* Preserve the original rejection. */
    }
    throw primary;
  }
}

// Normal-CI Idle correctness helpers. No helper loads or samples source assets.
test('source-free Idle timetable freezes sixteen actual Core C frames', async () => {
  const table = await prepareIdleRenderTimetable();
  expect(table.frames).toHaveLength(16);
  expect(table.frames.map((f) => f.snapshot.clocks.gameTimeMs)).toEqual(
    Array.from({ length: 16 }, (_, i) => (i + 1) * 20),
  );
  expect(table.frames.map((f) => f.snapshot.revision)).toEqual(
    Array.from({ length: 16 }, (_, i) => 6 + i * 3),
  );
  const off = await prepareIdleRenderTimetable(false);
  expect(table.frames.map((f) => f.snapshot)).toEqual(
    off.frames.map((f) => f.snapshot),
  );
  expect(
    table.frames.map((f) =>
      f.spatial.actors.map(({ pose: _pose, ...rest }) => rest),
    ),
  ).toEqual(
    off.frames.map((f) =>
      f.spatial.actors.map(({ pose: _pose, ...rest }) => rest),
    ),
  );
  const fs = await import('node:fs'),
    path = await import('node:path');
  fs.mkdirSync('reports', { recursive: true });
  const directory = fs.mkdtempSync(
    path.resolve('reports/idle-current-dry-run-'),
  );
  fs.writeFileSync(
    path.join(directory, 'timetable.json'),
    JSON.stringify(
      {
        sourceFree: true,
        actualB: 0,
        actualH: 0,
        frames: table.frames,
        planned: {
          hInitialization: 42,
          bRuntime: 64,
          hRuntime: 32,
          executions: 1,
          total: 138,
        },
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
});

test('source-free Idle timer forwards unchanged frames and excludes capture', () => {
  const frames = [{ clock: 20 }, { clock: 40 }],
    events: unknown[] = [],
    elapsed: number[] = [];
  let now = 0;
  measureIdleFrames(
    frames,
    (frame) => {
      events.push(frame);
      now += 7;
    },
    (frame) => {
      events.push(['capture', frame]);
      now += 100;
    },
    elapsed,
    () => {
      events.push('clock');
      return now;
    },
  );
  expect(elapsed).toEqual([7, 7]);
  expect(events).toEqual([
    'clock',
    frames[0],
    'clock',
    ['capture', frames[0]],
    'clock',
    frames[1],
    'clock',
    ['capture', frames[1]],
  ]);
});

test('source-free Idle timer preserves thrown render and elapsed without capture', () => {
  const primary = Error('render failed'),
    elapsed: number[] = [];
  let calls = 0,
    captures = 0;
  expect(() =>
    measureIdleFrames(
      [1, 2],
      () => {
        throw primary;
      },
      () => {
        captures++;
      },
      elapsed,
      () => ++calls,
    ),
  ).toThrow(primary);
  expect(elapsed).toEqual([1]);
  expect(captures).toBe(0);
});

test('source-free Idle ledger records 42 initialization 64 B and 32 H units', () => {
  const names = Array.from({ length: 42 }, (_, i) => 'clip' + i);
  const ledger = createIdleLedger(names);
  names.forEach((name) => {
    ledger.checkpoint(`clip:${name}`);
  });
  ledger.beginRender();
  for (let i = 0; i < 64; i++) {
    ledger.beforeB();
    ledger.afterB();
  }
  ledger.beginOracle();
  for (let i = 0; i < 32; i++) {
    ledger.beforeH();
    ledger.afterH();
  }
  ledger.finish();
  expect(ledger.read()).toMatchObject({
    hInitReserved: 42,
    hInitCompleted: 42,
    bAttempted: 64,
    bCompleted: 64,
    hReserved: 32,
    hCompleted: 32,
    allInReserved: 138,
  });
});

test('source-free Idle ledger rejects incomplete duplicate or foreign initialization', () => {
  const names = Array.from({ length: 42 }, (_, i) => 'clip' + i);
  expect(() => createIdleLedger(names.slice(1))).toThrow();
  const ledger = createIdleLedger(names);
  expect(() => ledger.beginRender()).toThrow();
  expect(() => ledger.checkpoint('clip:foreign')).toThrow();
  ledger.checkpoint('clip:clip0');
  expect(() => ledger.checkpoint('clip:clip0')).toThrow();
});

test('source-free Idle ledger rejects preparation sampling early H and cap excess', () => {
  const names = Array.from({ length: 42 }, (_, i) => 'clip' + i);
  expect(() => createIdleLedger(names).beforeB()).toThrow();
  const ledger = createIdleLedger(names);
  names.forEach((name) => {
    ledger.checkpoint(`clip:${name}`);
  });
  ledger.beginRender();
  expect(() => ledger.beforeH()).toThrow();
  for (let i = 0; i < 64; i++) {
    ledger.beforeB();
    ledger.afterB();
  }
  expect(() => ledger.beforeB()).toThrow();
  expect(() => ledger.beginOracle()).toThrow(); // attempted excess stays visible
});

test('source-free Idle cleanup runs in reverse and preserves primary through seal failure', async () => {
  const primary = Error('primary'),
    order: string[] = [];
  let terminal: { failed: boolean; cleanupErrors: string[] } | undefined;
  await expect(
    ownIdleRun(
      async () => {
        throw primary;
      },
      [
        () => {
          order.push('first');
        },
        () => {
          order.push('second');
          throw Error('cleanup');
        },
      ],
      (result) => {
        terminal = result;
        throw Error('seal');
      },
    ),
  ).rejects.toBe(primary);
  expect(order).toEqual(['second', 'first']);
  expect(terminal).toMatchObject({
    failed: true,
    cleanupErrors: ['Error: cleanup'],
  });
});

test('source-free Idle cleanup seals success and fails closed on cleanup error', async () => {
  const terminals: unknown[] = [];
  await ownIdleRun(
    async () => {},
    [() => {}],
    (result) => {
      terminals.push(result);
    },
  );
  expect(terminals).toEqual([{ failed: false, cleanupErrors: [] }]);
  await expect(
    ownIdleRun(
      async () => {},
      [
        () => {
          throw Error('release');
        },
      ],
      (result) => {
        terminals.push(result);
      },
    ),
  ).rejects.toThrow('release');
  expect(terminals[1]).toMatchObject({
    failed: true,
    cleanupErrors: ['Error: release'],
  });
});

async function prepareIdleRenderTimetable(recoveryEnabled = true) {
  const { createCore } = await import('../../src/core');
  const { createSpatialEngine } = await import(
    '../../src/world/spatial-engine'
  );
  const { clipId, durationMs } = await import('../../src/contracts');
  const { fixtureCatalog, run } = await import('../core/fixtures/scenarios');
  const { viewport } = await import('../world/fixtures');
  const synthetic = fixtureCatalog();
  const motions: import('../../src/contracts').MotionCatalogPort = {
    ...synthetic.catalog,
    prepare: async () => {},
    dispose() {},
    sampleMotion: () => undefined,
  };
  const idle = {
    clipId: clipId('Idle'),
    durationMs: durationMs(2022.2222805023193),
    sourceBindingId:
      'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
  };
  const bindings: import('../../src/contracts').PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'idle-pair-authentic-selected-auxiliary-synthetic',
    clips: [
      idle,
      ...['walk', 'run', 'jump'].map((id) => ({
        clipId: clipId(id),
        durationMs: durationMs(100),
        sourceBindingId: 'unused:' + id,
      })),
      ...motions.list().map((motion) => ({
        clipId: motion.clipId,
        durationMs: motion.durationMs,
        sourceBindingId: 'unrendered:' + motion.clipId,
      })),
    ],
    locomotion: {
      idle: idle.clipId,
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  const recovery = {
    version: 1,
    protocol: 'kungfu-recovery-epoch-diagnostic-v1',
    durationMs: durationMs(150),
    fixedLiftSign: 1,
  } as const;
  // BOTH ledgers are explicitly empty. No Core vehicle may lack a C collider.
  const core = createCore(
    { runId: run, seed: 1 },
    {
      catalog: motions,
      moves: synthetic.moves,
      enemyAi: false,
      world: { vehicles: [], objects: [] },
    },
  );
  const spatial = createSpatialEngine(
    run,
    { ...SceneModule.createParisStreetLayout(), vehicles: [], objects: [] },
    {
      version: 1,
      mode: 'deterministic-pose-v1',
      ...(recoveryEnabled ? { recovery } : {}),
    },
  );
  type Frame = import('../../src/contracts').CommittedFrame;
  const frames: Frame[] = [];
  const commit = (output = core.drain()): Frame => ({
    ...output,
    spatial: spatial.commit(output),
    viewport,
  });
  try {
    commit();
    required(spatial.poseProtocol).bindPreparedCatalog(bindings);
    core.handle({ type: 'AssetsReady', runId: run });
    commit();
    core.handle({ type: 'StartRequested', runId: run });
    const initial = commit();
    const residents = required(initial.snapshot.residentActorIds);
    expect(residents).toHaveLength(2);
    expect(
      residents.map(
        (id) =>
          required(initial.snapshot.actors.find((a) => a.actorId === id)).color,
      ),
    ).toEqual(['white', 'blue']);
    const initialEpochs = residents.map(
      (id) =>
        required(initial.spatial.actors.find((a) => a.actorId === id)).pose,
    );
    const hp = initial.snapshot.actors.map((actor) => actor.hp);
    for (let row = 0; row < 16; row++) {
      core.present(durationMs(20));
      const request = core.beginStep({ durationMs: durationMs(20) });
      const result = spatial.step(request, motions);
      expect(result.candidates).toEqual([]);
      const frame = commit(core.completeStep(result));
      expect(frame.snapshot.phase).toBe('running');
      expect(frame.snapshot.residentActorIds).toEqual(residents);
      expect(frame.snapshot.actors.map((actor) => actor.hp)).toEqual(hp);
      expect(
        frame.snapshot.actors.every(
          (actor) => actor.attack === null && !actor.defeated,
        ),
      ).toBe(true);
      expect(frame.snapshot.world.vehicles).toEqual([]);
      expect(frame.snapshot.world.objects).toEqual([]);
      expect(frame.spatial.vehicles).toEqual([]);
      expect(frame.snapshot.clocks).toMatchObject({
        gameTimeMs: (row + 1) * 20,
        presentationTimeMs: (row + 1) * 20,
        activeRealTimeMs: (row + 1) * 20,
      });
      for (const [index, id] of residents.entries()) {
        const actor = required(
          frame.spatial.actors.find((a) => a.actorId === id),
        );
        expect(actor.pose).toEqual(initialEpochs[index]);
        expect(actor.pose).toMatchObject({
          kind: 'living',
          living: {
            binding: idle,
            mode: 'idle',
            startedAt: 0,
            playback: 'loop',
            activationId: null,
          },
        });
      }
      frames.push(frame);
    }
    return { frames, run, viewport, recovery, idle };
  } finally {
    spatial.dispose();
    core.dispose();
  }
}

function measureIdleFrames<T>(
  frames: readonly T[],
  render: (frame: T) => void,
  capture: (frame: T, row: number) => void,
  elapsed: number[],
  now: () => number = () => performance.now(),
): void {
  frames.forEach((frame, row) => {
    const start = now();
    try {
      render(frame);
    } finally {
      elapsed.push(now() - start);
    }
    capture(frame, row); // Always outside both timer reads; never runs after a failed render.
  });
}

function createIdleLedger(names: readonly string[]) {
  const trusted = new Set(names),
    witnessed = new Set<string>();
  if (names.length !== 42 || trusted.size !== 42)
    throw Error('Expected 42 trusted H clips');
  let phase: 'preparation' | 'render' | 'oracle' | 'finished' = 'preparation';
  let bAttempted = 0,
    bCompleted = 0,
    hReserved = 0,
    hCompleted = 0;
  const read = () => ({
    phase,
    hInitReserved: 42,
    hInitCompleted: witnessed.size,
    hInitClipIds: [...witnessed],
    bAttempted,
    bCompleted,
    hReserved,
    hCompleted,
    allInReserved: 42 + bAttempted + hReserved,
    hardCap: 138,
  });
  return {
    read,
    checkpoint(stage: string) {
      if (!stage.startsWith('clip:')) return;
      const id = stage.slice(5);
      if (phase !== 'preparation' || !trusted.has(id) || witnessed.has(id))
        throw Error('Invalid H clip checkpoint');
      witnessed.add(id);
    },
    beginRender() {
      if (phase !== 'preparation' || witnessed.size !== 42 || bAttempted !== 0)
        throw Error('Incomplete initialization');
      phase = 'render';
    },
    beforeB() {
      bAttempted++;
      if (phase !== 'render' || bAttempted > 64)
        throw Error('Unexpected B evaluation or cap excess');
    },
    afterB() {
      bCompleted++;
    },
    beginOracle() {
      if (phase !== 'render' || bAttempted !== 64 || bCompleted !== 64)
        throw Error('Incomplete render ledger');
      phase = 'oracle';
    },
    beforeH() {
      if (phase !== 'oracle') throw Error('H query outside oracle phase');
      hReserved++;
      if (hReserved > 32 || 42 + bAttempted + hReserved > 138)
        throw Error('Hard138 source cap exceeded');
    },
    afterH() {
      hCompleted++;
    },
    finish() {
      if (phase !== 'oracle' || hReserved !== 32 || hCompleted !== 32)
        throw Error('Incomplete H oracle ledger');
      phase = 'finished';
    },
  };
}

type IdleTerminal = {
  failed: boolean;
  primaryError?: string;
  cleanupErrors: string[];
};
async function ownIdleRun(
  body: () => Promise<void>,
  cleanups: Array<() => void>,
  seal: (result: IdleTerminal) => void,
): Promise<void> {
  let failed = false,
    primary: unknown;
  const cleanupErrors: string[] = [];
  try {
    await body();
  } catch (error) {
    failed = true;
    primary = error;
  }
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup();
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  if (!failed && cleanupErrors.length) {
    failed = true;
    primary = Error('Cleanup failed: ' + cleanupErrors.join('; '));
  }
  try {
    seal({
      failed,
      ...(failed ? { primaryError: String(primary) } : {}),
      cleanupErrors,
    });
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = error;
    }
  }
  if (failed) throw primary;
}

// Normal-CI current-implementation correctness, not a timing comparison.
// Exactly one 138-unit execution; no warmup or performance acceptance threshold.
test('public B preserves sixteen advancing Idle frames within 138 all-in units', async () => {
  const fs = await import('node:fs'),
    path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { AnimationMixer, Group, Matrix4, SkinnedMesh } = await import('three');
  const { ANDROID_DERIVED_PACK_V1 } = await import(
    '../../src/assets/derivedPackManifest'
  );
  const { createActorAnimator } = await import(
    '../../src/assets/actorAnimator'
  );
  const { preparePinnedSourceHead } = await import(
    '../../src/assets/headSurface'
  );
  const { loadKungFuStraightDiagnostics, KUNG_FU_STRAIGHT_SOURCE_PINS } =
    await import('../../tools/assets/kungFuStraightDiagnostic');
  fs.mkdirSync('reports', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('reports/idle-render-source-'));
  const records: unknown[] = [],
    elapsedMs: number[] = [];
  const ledger = createIdleLedger(
    ANDROID_DERIVED_PACK_V1.clips.map((clip) => clip.name),
  );
  let fullRigs = 0,
    peakRigs = 0,
    staged = 0,
    peakStaged = 0,
    mounts = 0;
  let packPrepared = false,
    hPrepared = false,
    packDisposed = false,
    hDisposed = false;
  let publicRenders = 0;
  const cleanups: Array<() => void> = [
    () => {
      if (
        fullRigs !== 0 ||
        staged !== 0 ||
        mounts !== 0 ||
        (packPrepared && !packDisposed) ||
        (hPrepared && !hDisposed)
      )
        throw Error('Outstanding Idle run ownership');
    },
  ];
  await ownIdleRun(
    async () => {
      const git = (...args: string[]) =>
        execFileSync('git', args, { encoding: 'utf8' }).trim();
      if (git('status', '--porcelain', '--untracked-files=no'))
        throw Error('Frozen clean commit required');
      records.push({
        marker: 'IDENTITY',
        value: {
          commit: git('rev-parse', 'HEAD'),
          tree: git('rev-parse', 'HEAD^{tree}'),
          harnessBlob: git(
            'rev-parse',
            'HEAD:tests/integration/stampedConsumerIntegration.test.ts',
          ),
          node: process.version,
          variant: 'normal-ci-current-canonical-reuse',
          scope:
            'one current-implementation correctness execution; no timing comparison or frame-budget/device acceptance',
        },
      });
      const timetable = await prepareIdleRenderTimetable();
      records.push({
        marker: 'ADMISSION',
        value: {
          frames: timetable.frames,
          hInitialization: 42,
          bRuntime: 64,
          hRuntime: 32,
          executions: 1,
          total: 138,
          performanceAccepted: false,
          hStaticBindHierarchyUpdates: 1,
          initializationIsCheckpointWitness: true,
          unitsAreNotUniformCpuCosts: true,
          actualPrivateConstructionDisposalMeasured: false,
          hiddenWarmups: 0,
        },
      });
      const sourceBytes = fs.readFileSync(
        KUNG_FU_STRAIGHT_SOURCE_PINS.sourcePath,
      );
      const entries = loadKungFuStraightDiagnostics({
        sourceBytes,
        manifestBytes: fs.readFileSync(
          KUNG_FU_STRAIGHT_SOURCE_PINS.manifestPath,
        ),
        recipeBytes: fs.readFileSync(
          'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
        ),
        candidateBytes: fs.readFileSync(
          'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
        ),
      });
      const rootPolicies = entries.map((entry) => entry.rootPolicy);
      const derivedBytes = fs.readFileSync(
        'public/game-assets/android/derived-pack-v1.glb',
      );
      const artifactBytes = fs.readFileSync(
        'public/game-assets/android/runtime-artifact-v1.json',
      );
      const hash = (bytes: Uint8Array) =>
        createHash('sha256').update(bytes).digest('hex');
      records.push({
        marker: 'INPUTS',
        value: {
          sourceSha256: hash(sourceBytes),
          derivedSha256: hash(derivedBytes),
          artifactSha256: hash(artifactBytes),
          rootPolicies,
        },
      });
      // This observer covers preparation as well as render and oracle phases.
      // During render it only accounts, delegates and enforces the hard cap.
      const originalUpdate = AnimationMixer.prototype.update;
      AnimationMixer.prototype.update = function (
        this: InstanceType<typeof AnimationMixer>,
        delta: number,
      ) {
        ledger.beforeB();
        const result = originalUpdate.call(this, delta);
        ledger.afterB();
        return result;
      };
      cleanups.push(() => {
        AnimationMixer.prototype.update = originalUpdate;
      });
      const controller = new AbortController(),
        started = performance.now();
      const timer = setTimeout(() => controller.abort(), 30_000);
      cleanups.push(() => {
        clearTimeout(timer);
        controller.abort();
      });
      const pack = await createPinnedDerivedThreeAssetPack({
        derivedBytes,
        artifactBytes,
        rootPolicies,
        signal: controller.signal,
      });
      packPrepared = true;
      cleanups.push(() => {
        pack.dispose();
        packDisposed = true;
      });
      const bPreparationMs = performance.now() - started,
        hStart = performance.now();
      const numeric = await preparePinnedSourceHead({
        derivedBytes,
        rootPolicies,
        signal: controller.signal,
        checkpoint: async (stage) => {
          ledger.checkpoint(stage);
        },
      });
      hPrepared = true;
      cleanups.push(() => {
        numeric.dispose();
        hDisposed = true;
      });
      const hPreparationMs = performance.now() - hStart,
        preparationMs = performance.now() - started;
      clearTimeout(timer);
      expect(preparationMs).toBeLessThan(30_000);
      const descriptor = required(pack.poseBindings);
      expect(pack.recoveryCapability).toEqual(timetable.recovery);
      expect(descriptor.clips.find((clip) => clip.clipId === 'Idle')).toEqual(
        timetable.idle,
      );
      expect(pack.clipDuration(timetable.idle.clipId)).toBe(
        timetable.idle.durationMs,
      );
      expect(
        numeric.poseBindings.clips.find((clip) => clip.clipId === 'Idle'),
      ).toEqual(timetable.idle);
      expect(ledger.read().bAttempted).toBe(0);
      expect([...ledger.read().hInitClipIds].sort()).toEqual(
        ANDROID_DERIVED_PACK_V1.clips.map((clip) => clip.name).sort(),
      );
      records.push({
        marker: 'PREPARATION',
        value: {
          bPreparationMs,
          hPreparationMs,
          preparationMs,
          counts: ledger.read(),
          descriptor,
          hDescriptor: numeric.descriptor,
        },
      });
      type Rig = ReturnType<typeof pack.create>;
      type Driver = NonNullable<Rig['poseFrame']>;
      type Request =
        import('../../src/assets/poseFramePreparation').PoseFrameRequest;
      const rigs = new Map<string, Rig>(),
        parents = new Map<string, InstanceType<typeof Group>>();
      const requests: Request[] = [],
        wrapped = new WeakMap<Driver, Driver>();
      const byColor = new Map(
        required(timetable.frames[0]).snapshot.actors.map((actor) => [
          actor.color,
          actor.actorId,
        ]),
      );
      const wrapDriver = (driver: Driver): Driver => {
        const found = wrapped.get(driver);
        if (found) return found;
        const observer: Driver = {
          capability: driver.capability,
          prepare(request) {
            requests.push(request);
            return driver.prepare(request);
          },
          apply(command) {
            driver.apply(command);
          },
          dispose() {
            driver.dispose();
          },
        };
        wrapped.set(driver, observer);
        return observer;
      };
      const animator = createActorAnimator<import('three').Object3D>(
        {
          runId: timetable.run,
          seed: 1,
          posePolicy: {
            version: 1,
            mode: 'deterministic-pose-v1',
            recovery: timetable.recovery,
          },
          viewport: {
            read: () => timetable.viewport,
            subscribe: () => () => {},
          },
          renderHost: {
            runId: timetable.run,
            mountActor({ actorId, node }) {
              const parent = new Group();
              parent.position.set(0.7, 2, -0.8);
              parent.rotation.y = 0.43;
              parent.add(node);
              parent.updateMatrixWorld(true);
              parents.set(actorId, parent);
              mounts++;
              return () => {
                node.removeFromParent();
                parents.delete(actorId);
                mounts--;
              };
            },
            publishDefeatPoseSupport() {
              return true;
            },
          },
        },
        {
          poseBindings: descriptor,
          recoveryCapability: required(pack.recoveryCapability),
          locomotionClips: descriptor.locomotion,
          clipDuration: pack.clipDuration,
          create() {
            throw Error('Idle diagnostic must use CPU stage');
          },
          stageActor(color) {
            const handle = required(pack.stageActor)(color);
            staged++;
            peakStaged = Math.max(peakStaged, staged);
            let closed = false,
              transferred = false;
            const driver = wrapDriver(handle.poseFrame);
            return {
              poseFrame: driver,
              materialize() {
                let id: string | undefined,
                  counted = false;
                const release = (rig: Rig) => {
                  if (closed) return;
                  closed = true;
                  if (id !== undefined) rigs.delete(id);
                  if (counted) {
                    fullRigs--;
                    counted = false;
                  }
                  rig.dispose();
                };
                return transferMaterialized(
                  () => handle.materialize(),
                  (rig) => {
                    transferred = true;
                    staged--;
                    fullRigs++;
                    counted = true;
                    peakRigs = Math.max(peakRigs, fullRigs);
                    if (peakRigs > 2 || peakStaged > 2)
                      throw Error('Two-resident ownership cap exceeded');
                    id = required(byColor.get(color));
                    rigs.set(id, rig);
                    return {
                      ...rig,
                      poseFrame: driver,
                      dispose() {
                        release(rig);
                      },
                    };
                  },
                  release,
                );
              },
              dispose() {
                if (closed || transferred) return;
                closed = true;
                staged--;
                handle.dispose();
              },
            };
          },
        },
      );
      cleanups.push(() => animator.dispose());
      const expectedParent = new Group();
      expectedParent.rotation.y = 0.43;
      const adjustment = new Matrix4()
        .fromArray(numeric.descriptor.headAttachmentAtBind)
        .invert()
        .multiply(
          new Matrix4().fromArray(numeric.descriptor.referenceToActorAtBind),
        );
      const captures: Array<{
        row: number;
        actorId: string;
        displayed: number[];
        epoch: import('../../src/contracts').LivingPoseStamp;
        at: import('../../src/contracts').GameTimeMs;
      }> = [];
      ledger.beginRender();
      measureIdleFrames(
        timetable.frames,
        (frame) => animator.render(frame), // The ONLY measured callback.
        (frame, row) => {
          publicRenders++;
          expect(ledger.read().bAttempted).toBe((row + 1) * 4);
          expect(ledger.read().bCompleted).toBe((row + 1) * 4);
          expect(fullRigs).toBe(2);
          expect(staged).toBe(0);
          expect(mounts).toBe(2);
          expect(requests.length).toBe((row + 1) * 2);
          const currentRequests = requests.slice(row * 2, row * 2 + 2);
          records.push({
            marker: 'REQUESTS',
            value: { row: row + 1, requests: currentRequests },
          });
          for (const id of required(frame.snapshot.residentActorIds)) {
            const actor = required(
              frame.spatial.actors.find((entry) => entry.actorId === id),
            );
            const pose = required(actor.pose);
            if (pose.kind !== 'living') throw Error('Noncanonical Idle frame');
            const request = required(
              currentRequests.find((entry) => entry.actorId === id),
            );
            expect(request).toMatchObject({
              kind: 'living',
              epoch: pose.living,
              at: frame.snapshot.clocks.gameTimeMs,
              side: 'right',
            });
            const rig = required(rigs.get(id)),
              parent = required(parents.get(id));
            const physical = {
              p: parent.position.toArray(),
              q: parent.quaternion.toArray(),
              s: parent.scale.toArray(),
            };
            expect(physical).toEqual({
              p: [0.7, 2, -0.8],
              q: expectedParent.quaternion.toArray(),
              s: [1, 1, 1],
            });
            const meshes: InstanceType<typeof SkinnedMesh>[] = [];
            const nodes: Array<{
              index: number;
              name: string;
              t: number[];
              q: number[];
              s: number[];
              world: number[];
            }> = [];
            // Read already-applied transforms. No seek, mixer, skeleton update or B replay.
            rig.node.traverse((part) => {
              if (part instanceof SkinnedMesh) meshes.push(part);
              const values = {
                t: part.position.toArray(),
                q: part.quaternion.toArray(),
                s: part.scale.toArray(),
                world: part.matrixWorld.toArray(),
              };
              expect(Object.values(values).flat().every(Number.isFinite)).toBe(
                true,
              );
              nodes.push({ index: nodes.length, name: part.name, ...values });
            });
            records.push({
              marker: 'APPLIED_RAW',
              value: { row: row + 1, actorId: id, physical, nodes },
            });
            const mesh = required(meshes[numeric.descriptor.meshIndex]);
            const bone = required(
              mesh.skeleton.bones[numeric.descriptor.headJointIndex],
            );
            const displayed = new Matrix4()
              .copy(rig.node.matrixWorld)
              .invert()
              .multiply(bone.matrixWorld)
              .multiply(adjustment)
              .toArray();
            captures.push({
              row: row + 1,
              actorId: id,
              displayed,
              epoch: pose.living,
              at: frame.snapshot.clocks.gameTimeMs,
            });
          }
        },
        elapsedMs,
      );
      expect(publicRenders).toBe(16);
      expect(elapsedMs).toHaveLength(16);
      // All independent H posing happens AFTER the complete measured sequence.
      ledger.beginOracle();
      for (const captured of captures) {
        ledger.beforeH();
        const sample = numeric.epochDiagnostic.point(
          captured.epoch,
          captured.at,
          'right',
        );
        ledger.afterH();
        records.push({ marker: 'H_CURRENT', value: { ...captured, sample } });
        if (sample.kind !== 'transform')
          throw Error(`Unsupported H: ${sample.reason}`);
        captured.displayed.forEach((value, index) => {
          expect(Math.abs(value - required(sample.matrix[index]))).toBeLessThan(
            1e-10,
          );
        });
      }
      ledger.finish();
      expect(peakRigs).toBe(2);
      expect(peakStaged).toBe(2);
      records.push({
        marker: 'PASS',
        value: {
          publicRenders,
          actorPreparations: requests.length,
          hQueries: captures.length,
          packs: 1,
          fullRigs,
          peakRigs,
          peakStaged,
          privateGraphConstructionDisposal: 'unmeasured',
          framePerformanceAccepted: false,
        },
      });
    },
    cleanups,
    (terminal) => {
      records.push({ marker: 'RENDER_ONLY_MS', value: elapsedMs });
      records.push({
        marker: 'TERMINAL',
        value: {
          ...terminal,
          counts: ledger.read(),
          publicRenders,
          renderAttempts: elapsedMs.length,
          fullRigs,
          peakRigs,
          staged,
          peakStaged,
          mounts,
          packPrepared,
          hPrepared,
          packDisposed,
          hDisposed,
          cleanupComplete:
            terminal.cleanupErrors.length === 0 &&
            fullRigs === 0 &&
            staged === 0 &&
            mounts === 0,
        },
      });
      fs.writeFileSync(
        path.join(directory, 'idle-render-receipt.json'),
        JSON.stringify(records, null, 2) + '\n',
        { encoding: 'utf8', flag: 'wx' },
      );
    },
  );
}, 60_000);

/** SOURCE-FREE Stage3: real Core/C history, synthetic combat descriptors and
 * canonical snapshots and a tiny synthetic pack. No authentic source asset,
 * real H provider, WebGL renderer or visual capture is opened.
 * Exact-start and left-end rows are direct retained-epoch diagnostics, NOT
 * committed public frames. Authentic B/H costs remain separately reserved. */
async function runStartupStage3Observer(
  authentic = false,
  policyVersion: 1 | 2 = 1,
) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createCore } = await import('../../src/core');
  const { createSpatialEngine } = await import(
    '../../src/world/spatial-engine'
  );
  const { deathClipSeconds } = await import('../../src/assets/deathAnimation');
  const { STARTUP_SOURCES, clipId, durationMs, gameTimeMs, poseClipTime } =
    await import('../../src/contracts');
  const { fixtureCatalog, run, attack, reference, envelope } = await import(
    '../core/fixtures/scenarios'
  );
  const { viewport } = await import('../world/fixtures');
  type Frame = import('../../src/contracts').CommittedFrame;
  type Epoch = import('../../src/contracts').PoseEpoch;
  const idle = {
    clipId: clipId('Idle'),
    durationMs: durationMs(2022.2222805023193),
    sourceBindingId:
      'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
  };
  const policy: import('../../src/contracts').StartupTimelinePolicy =
    policyVersion === 2
      ? {
          version: 2,
          protocol: 'side-kick-startup-matrix-v2',
          durationMs: durationMs(100),
          fixedLiftSign: 1,
          domain: 'fixed-positive-lift-midpoint-half-v1',
        }
      : {
          version: 1,
          protocol: 'side-kick-startup-matrix-v1',
          durationMs: durationMs(100),
          fixedLiftSign: 1,
        };
  const receiptName = authentic
    ? policyVersion === 2
      ? 'v2-success.json'
      : 'v1-known-rejection.json'
    : policyVersion === 2
      ? 'source-free-v2-timetable.json'
      : 'source-free-timetable.json';
  const cleanupErrors: string[] = [];
  const cleanup = (label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      cleanupErrors.push(label + ': ' + String(error));
    }
  };
  let primaryFailed = false;
  let primaryError: unknown;
  let directory = process.env.STARTUP_STAGE3_RECEIPT_DIR;
  if (authentic && !directory) {
    const { randomUUID } = await import('node:crypto');
    fs.mkdirSync('reports', { recursive: true });
    directory = path.resolve(
      'reports',
      `startup-v${policyVersion}-${randomUUID()}`,
    );
  }
  if (authentic && !path.isAbsolute(required(directory)))
    throw Error('Absolute fresh receipt directory required');
  const receipt: {
    rows: unknown[];
    histories: unknown[];
    rawObservations: unknown[];
    failure?: string;
    completed: boolean;
  } = { rows: [], histories: [], rawObservations: [], completed: false };
  let publicRows = 0,
    directRows = 0,
    observedCanonicalDispatches = 0,
    reservedB = 0;
  const { AnimationMixer, Group, Matrix4, SkinnedMesh } = await import('three');
  const { createActorAnimator } = await import(
    '../../src/assets/actorAnimator'
  );
  let observedBUpdates = 0,
    visibleCreated = 0,
    visibleDisposed = 0,
    liveVisible = 0,
    peakVisible = 0;
  const originalUpdate = AnimationMixer.prototype.update;
  const mixerSpy = vi
    .spyOn(AnimationMixer.prototype, 'update')
    .mockImplementation(function (
      this: import('three').AnimationMixer,
      dt: number,
    ) {
      observedBUpdates++;
      if (observedBUpdates > 86)
        throw Error(
          'Synthetic B update ceiling exceeded before extra evaluation',
        );
      return originalUpdate.call(this, dt);
    });
  let pack: Awaited<ReturnType<typeof startupStage3SyntheticPack>> | undefined;
  let numeric:
    | import('../../src/assets/headSurface').SourceHeadProvider
    | undefined;
  let queryPhase: 'B' | 'H' = 'B';
  let bCanonicalQueries = 0,
    hCanonicalQueries = 0;
  const rawQueries: Array<{
    provider: 'B' | 'H';
    epoch: import('../../src/contracts').PoseEpoch;
    sample: import('../../src/assets/recoveryDiagnostic').CanonicalPoseSnapshot;
  }> = [];
  const diagnosticModule = await import('../../src/assets/recoveryDiagnostic');
  const originalSampler = diagnosticModule.samplePoseEpoch;
  const samplerSpy = vi
    .spyOn(diagnosticModule, 'samplePoseEpoch')
    .mockImplementation((epoch, at, side, evaluate) =>
      originalSampler(epoch, at, side, (query) => {
        const provider = queryPhase;
        if (provider === 'B') {
          if (bCanonicalQueries >= 40)
            throw Error('B canonical cap before evaluator');
          bCanonicalQueries++;
        } else {
          if (hCanonicalQueries >= 40)
            throw Error('H canonical cap before evaluator');
          hCanonicalQueries++;
        }
        const sample = evaluate(query);
        rawQueries.push({ provider, epoch, sample });
        return sample;
      }),
    );
  const initializationIds = new Set<string>();
  let receiptFd: number | undefined;
  let authenticInputs: unknown;
  try {
    if (authentic) {
      const freshDirectory = required(directory);
      // Exclusive directory creation rejects any existing path before source work.
      fs.mkdirSync(freshDirectory);
      receiptFd = fs.openSync(path.join(freshDirectory, receiptName), 'wx');
    }
    if (authentic) {
      const prepared = await prepareStartupStage3Authentic(
        {
          ownPack: (value) => {
            pack = value;
          },
          ownHead: (value) => {
            numeric = value;
          },
          initializationIds,
        },
        policyVersion,
      );
      authenticInputs = prepared;
    } else pack = await startupStage3SyntheticPack();
    if (!pack) throw Error('Pack not prepared');
    expect(observedBUpdates).toBe(0);
    for (const motion of ['SideKick', 'SideThrustKick'] as const) {
      const pin = STARTUP_SOURCES[motion];
      const synthetic = fixtureCatalog(150);
      // Seed1435's frozen six indices are0,0,0,8,8,0 for pools4,4,4,19,19,4.
      // All other synthetic members satisfy Core catalog rules but are never
      // selected, rendered or treated as authentic source bindings.
      const mappedId = (id: import('../../src/contracts').ClipId) =>
        id === 'kick:8'
          ? pin.binding.clipId
          : id === 'punch:0'
            ? idle.clipId
            : id;
      const definitions = synthetic.catalog.list().map((base) => {
        const selected = base.clipId === 'kick:8';
        const auxiliary = base.clipId === 'punch:0';
        if (!selected && !auxiliary) return base;
        const end = selected ? pin.binding.durationMs : idle.durationMs;
        return {
          ...base,
          clipId: mappedId(base.clipId),
          durationMs: end,
          impacts: [
            {
              ...base.impacts[0]!,
              startMs: selected ? pin.firstActiveMs : durationMs(0),
              endMs: selected
                ? durationMs(
                    motion === 'SideKick'
                      ? 622.2222447395325
                      : 888.8888955116272,
                  )
                : end,
            },
          ],
          rootCurve: base.rootCurve.map((point, i) => ({
            ...point,
            atMs: durationMs(i ? end : 0),
          })),
        };
      });
      const catalog: import('../../src/contracts').MotionCatalogPort = {
        prepare: async () => {},
        dispose() {},
        list: () => definitions,
        get: (id) => definitions.find((d) => d.clipId === id),
        sampleMotion: () => undefined,
      };
      const mappedSet = (color: ActorColor) => ({
        punches: synthetic.moves[color].punches.map(mappedId),
        kicks: synthetic.moves[color].kicks.map(mappedId),
      });
      const moves = {
        white: mappedSet('white'),
        black: mappedSet('black'),
        blue: mappedSet('blue'),
        green: mappedSet('green'),
        yellow: mappedSet('yellow'),
      };
      const owned: Array<{ label: string; dispose: () => void }> = [];
      const own = <T extends { dispose(): void }>(
        label: string,
        resource: T,
      ): T => {
        owned.push({ label, dispose: () => resource.dispose() });
        return resource;
      };
      const trace: unknown[] = [];
      const rigs = new Map<
        ActorColor,
        import('../../src/assets/actorAnimator').ActorRig<
          import('three').Object3D
        >
      >();
      try {
        const core = own(
          'core',
          createCore(
            { runId: run, seed: 1435 },
            { catalog, moves, enemyAi: false },
          ),
        );
        const spatial = own(
          'spatial',
          createSpatialEngine(
            run,
            {
              ...SceneModule.createParisStreetLayout(),
              vehicles: [],
              objects: [],
            },
            {
              version: 1,
              mode: 'deterministic-pose-v1',
              attackStartStance: 'selected-side-kicks-v1',
              startup: policy,
            },
          ),
        );
        const emptyLayout = {
          ...SceneModule.createParisStreetLayout(),
          vehicles: [],
          objects: [],
        };
        const stanceOnly = own(
          'stanceOnly',
          createSpatialEngine(run, emptyLayout, {
            version: 1,
            mode: 'deterministic-pose-v1',
            attackStartStance: 'selected-side-kicks-v1',
          }),
        );
        const defaultOff = own(
          'defaultOff',
          createSpatialEngine(run, emptyLayout),
        );
        const explicitOff = own(
          'explicitOff',
          createSpatialEngine(run, emptyLayout, {
            version: 1,
            mode: 'legacy',
          }),
        );
        const physical = (
          snapshot: import('../../src/contracts').SpatialSnapshot,
        ) => ({
          ...snapshot,
          actors: snapshot.actors.map(({ pose: _pose, ...actor }) => actor),
        });
        const bindings: import('../../src/contracts').PoseCatalogBindings = {
          version: 1,
          bindingSetId: 'source-free-startup-authentic-pins-synthetic-combat',
          clips: [
            idle,
            pin.binding,
            ...['walk', 'run', 'jump'].map((id) => ({
              clipId: clipId(id),
              durationMs: durationMs(100),
              sourceBindingId: 'synthetic-unused:' + id,
            })),
          ],
          locomotion: {
            idle: idle.clipId,
            walk: clipId('walk'),
            run: clipId('run'),
            jump: clipId('jump'),
          },
        };
        const outerBaselines = new Map<ActorColor, readonly number[]>();
        const preparedPack = pack;
        const animator = own(
          'animator',
          createActorAnimator<import('three').Object3D>(
            {
              runId: run,
              seed: 1435,
              posePolicy: {
                version: 1,
                mode: 'deterministic-pose-v1',
                attackStartStance: 'selected-side-kicks-v1',
                startup: policy,
              },
              viewport: { read: () => viewport, subscribe: () => () => {} },
              renderHost: {
                runId: run,
                mountActor: ({ node }) => {
                  const parent = new Group();
                  parent.add(node);
                  return () => node.removeFromParent();
                },
                publishDefeatPoseSupport: () => true,
              },
            },
            {
              poseBindings: required(preparedPack.poseBindings),
              startupCapability: required(preparedPack.startupCapability),
              locomotionClips: preparedPack.poseBindings!.locomotion,
              clipDuration: preparedPack.clipDuration,
              create: () => {
                throw Error('CPU stage required');
              },
              stageActor: (color) => {
                const before = observedBUpdates,
                  handle = required(preparedPack.stageActor)(color);
                try {
                  expect(observedBUpdates).toBe(before);
                } catch (error) {
                  cleanup('failed-stage-handle', () => handle.dispose());
                  throw error;
                }
                return {
                  poseFrame: handle.poseFrame,
                  dispose: () => handle.dispose(),
                  materialize: () => {
                    const beforeMaterialize = observedBUpdates,
                      rig = handle.materialize();
                    let closed = false;
                    visibleCreated++;
                    liveVisible++;
                    peakVisible = Math.max(peakVisible, liveVisible);
                    const tracked = {
                      ...rig,
                      dispose: () => {
                        if (closed) return;
                        closed = true;
                        visibleDisposed++;
                        liveVisible--;
                        rig.dispose();
                        rigs.delete(color);
                      },
                    };
                    rigs.set(color, tracked);
                    rig.node.updateMatrix();
                    outerBaselines.set(color, rig.node.matrix.toArray());
                    try {
                      expect(observedBUpdates).toBe(beforeMaterialize);
                      expect(peakVisible).toBeLessThanOrEqual(2);
                      return tracked;
                    } catch (error) {
                      cleanup('failed-materialization-rig', () =>
                        tracked.dispose(),
                      );
                      throw error;
                    }
                  },
                };
              },
            },
          ),
        );
        let frame!: Frame;
        const commit = (output = core.drain()) => {
          const current = spatial.commit(output);
          expect(physical(current)).toEqual(
            physical(stanceOnly.commit(output)),
          );
          expect(defaultOff.commit(output)).toEqual(explicitOff.commit(output));
          frame = { ...output, spatial: current, viewport };
          return frame;
        };
        const white = () =>
          required(core.read().actors.find((a) => a.color === 'white'));
        const perform = (
          dt: number,
          candidates: readonly import('../../src/contracts').SpatialCandidate[] = [],
        ) => {
          core.present(durationMs(dt));
          const request = core.beginStep({ durationMs: durationMs(dt) });
          const result = spatial.step(request, catalog);
          const stanceResult = stanceOnly.step(request, catalog);
          expect(physical(result.snapshot)).toEqual(
            physical(stanceResult.snapshot),
          );
          expect(result.candidates).toEqual(stanceResult.candidates);
          expect(defaultOff.step(request, catalog)).toEqual(
            explicitOff.step(request, catalog),
          );
          expect(result.candidates).toEqual([]);
          const output = core.completeStep({ ...result, candidates });
          trace.push({
            clocks: output.snapshot.clocks,
            events: output.events,
            candidates,
          });
          return commit(output);
        };
        const until = (target: number) => {
          while (core.read().clocks.gameTimeMs < target)
            perform(Math.min(20, target - core.read().clocks.gameTimeMs));
          expect(core.read().clocks.gameTimeMs).toBe(target);
        };
        const pose = (f: Frame, color: ActorColor) =>
          required(
            f.spatial.actors.find(
              (a) =>
                a.actorId ===
                required(f.snapshot.actors.find((s) => s.color === color))
                  .actorId,
            )?.pose,
          );
        const livingEpoch = (f: Frame, color: ActorColor): Epoch => {
          const p = pose(f, color);
          return p.kind === 'living'
            ? p.living
            : p.kind === 'defeat'
              ? p.entry
              : p.epoch;
        };
        const observe = (
          name: string,
          f: Frame,
          direct?: { at: number; side: 'left' | 'right'; white: Epoch },
        ) => {
          const beforeB = observedBUpdates;
          const beforeRaw = rawQueries.length;
          queryPhase = 'B';
          if (direct) {
            directRows++;
            const prepared = (['white', 'blue'] as const).map((color) => {
              const rig = required(rigs.get(color)),
                driver = required(rig.poseFrame);
              const actor = required(
                f.snapshot.actors.find((a) => a.color === color),
              );
              const command = driver.prepare({
                runId: run,
                actorId: actor.actorId,
                revision: f.snapshot.revision,
                kind: 'living',
                epoch: color === 'white' ? direct.white : livingEpoch(f, color),
                at: gameTimeMs(direct.at),
                side: direct.side,
              });
              return { driver, command };
            });
            for (const item of prepared) item.driver.apply(item.command);
          } else {
            publicRows++;
            animator.render(f);
          }
          const actualB = observedBUpdates - beforeB;
          const at = direct?.at ?? f.snapshot.clocks.gameTimeMs;
          const side = direct?.side ?? 'right';
          const actors = (['white', 'blue'] as const).map((color) => {
            const p = pose(f, color);
            const epoch =
              color === 'white' && direct
                ? direct.white
                : livingEpoch(f, color);
            const sampleAt =
              p.kind === 'defeat' && !direct ? p.entryAt : gameTimeMs(at);
            const sampleSide = p.kind === 'defeat' && !direct ? 'left' : side;
            const queries: unknown[] = [];
            const beforeH = rawQueries.length;
            queryPhase = 'H';
            const hSample = authentic
              ? p.kind === 'defeat' && !direct
                ? required(numeric).epochDiagnostic.entry(p)
                : required(numeric).epochDiagnostic.point(
                    epoch,
                    sampleAt,
                    sampleSide,
                  )
              : undefined;
            const sampled = authentic
              ? undefined
              : originalSampler(epoch, sampleAt, sampleSide, (query) => {
                  if (observedCanonicalDispatches >= 40)
                    throw Error(
                      'Shared canonical dispatch ceiling exceeded before evaluation',
                    );
                  observedCanonicalDispatches++;
                  queries.push(query);
                  return {
                    query,
                    rootMode:
                      query.stamp.binding.clipId === 'Idle'
                        ? 'full-translation'
                        : pin.rootPolicy,
                    hierarchyId: 'explicit-synthetic-one-node',
                    pose: [
                      {
                        id: 'root',
                        parent: null,
                        t: [query.clipTime / 1000, 0, 0],
                        q: [0, 0, 0, 1],
                        s: [1, 1, 1],
                      },
                    ],
                  };
                });
            if (authentic) {
              for (const item of rawQueries.slice(beforeH)) {
                expect(item.provider).toBe('H');
                queries.push(item.sample.query);
              }
              observedCanonicalDispatches += queries.length;
            }
            const b =
              queries.length * 2 + (p.kind === 'defeat' && !direct ? 3 : 0);
            reservedB += b;
            return {
              color,
              underlyingFramePose: p,
              requestedEpoch: epoch,
              queryAt: sampleAt,
              side: sampleSide,
              queries,
              syntheticKind: sampled?.kind,
              hSample,
              basisLayer: sampled?.basisLayer,
              reservedB: b,
              observedSharedQueries: queries.length,
            };
          });
          const observedRaw = rawQueries.slice(beforeRaw);
          if (authentic)
            receipt.rawObservations.push({
              motion,
              name,
              executionSequence: receipt.rows.length + 1,
              clocks: f.snapshot.clocks,
              actors,
              canonicalRaw: observedRaw,
              outerBaselines: [...outerBaselines],
              applied: [...rigs].map(([color, rig]) => {
                const nodes: unknown[] = [];
                rig.node.traverse((node) =>
                  nodes.push({
                    name: node.name,
                    t: node.position.toArray(),
                    q: node.quaternion.toArray(),
                    s: node.scale.toArray(),
                    matrix: node.matrix.toArray(),
                    world: node.matrixWorld.toArray(),
                  }),
                );
                return { color, nodes, support: rig.defeatPoseSupport?.() };
              }),
            });
          const oracle = authentic
            ? startupStage3AssertObserved({
                f,
                direct,
                actors,
                rigs,
                numeric: required(numeric),
                raw: observedRaw,
                outerBaselines,
                Matrix4,
                SkinnedMesh,
              })
            : undefined;
          expect(actualB).toBe(
            actors.reduce((n, actor) => n + actor.reservedB, 0),
          );
          receipt.rows.push({
            oracle,
            actualSyntheticBUpdates: authentic ? undefined : actualB,
            actualAuthenticBUpdates: authentic ? actualB : undefined,
            canonicalRaw: authentic ? observedRaw : undefined,
            executionSequence: receipt.rows.length + 1,
            motion,
            name,
            route: direct ? 'direct-retained-epoch' : 'public-retained-frame',
            revision: f.snapshot.revision,
            clocks: f.snapshot.clocks,
            actors,
          });
        };
        commit();
        spatial.poseProtocol!.bindPreparedCatalog(bindings);
        stanceOnly.poseProtocol!.bindPreparedCatalog(bindings);
        core.handle({ type: 'AssetsReady', runId: run });
        commit();
        core.handle({ type: 'StartRequested', runId: run });
        commit();
        for (const [index, start] of [0, 2100, 4200].entries()) {
          until(start);
          attack(core, 'blue');
          expect(
            core.read().actors.find((a) => a.color === 'blue')?.attack?.clipId,
          ).toBe('Idle');
          const source = reference(core, 'blue');
          perform(20, [
            {
              ...envelope(start + 10, 'startup-prime:' + index),
              interval: { from: gameTimeMs(start), to: gameTimeMs(start + 20) },
              kind: 'body-hit',
              source,
              targetActorId: white().actorId,
            },
          ]);
          expect(white().hp).toBe(500 - 150 * (index + 1));
        }
        until(7000);
        attack(core, 'white', 'kick');
        expect(white().attack?.startedAt).toBe(7000);
        expect(white().attack?.clipId).toBe(motion);
        // Match the real host: no commit between input flush and positive step.
        perform(20);
        const firstPose = pose(frame, 'white');
        expect(firstPose.kind).toBe('startup');
        if (firstPose.kind !== 'startup')
          throw Error('Actual C did not admit startup');
        const epoch = firstPose.epoch;
        expect(poseClipTime(epoch.outgoing, epoch.outgoingAt, 'left')).toBe(
          7000 % idle.durationMs,
        );
        const capturedFirst = frame;
        until(7050);
        const interior = frame;
        observe('2 public interior', interior);
        observe('1 exact start direct', capturedFirst, {
          at: 7000,
          side: 'right',
          white: epoch,
        });
        until(7100);
        observe('3 left end direct', frame, {
          at: 7100,
          side: 'left',
          white: epoch,
        });
        observe('4 public right end', frame);
        observe('5 public reverse interior', interior);
        observe('6 public exact repeat', interior);
        const second = 7000 + pin.binding.durationMs + 500;
        until(second);
        attack(core, 'white', 'kick');
        expect(white().attack?.clipId).toBe(motion);
        perform(20);
        const secondPose = pose(frame, 'white');
        expect(secondPose.kind).toBe('startup');
        if (secondPose.kind !== 'startup')
          throw Error('Second C startup missing');
        expect(secondPose.epoch.destination.activationId).not.toBe(
          epoch.destination.activationId,
        );
        expect(
          poseClipTime(
            secondPose.epoch.outgoing,
            secondPose.epoch.outgoingAt,
            'left',
          ),
        ).toBe(500);
        until(second + 40);
        attack(core, 'blue');
        expect(
          core.read().actors.find((a) => a.color === 'blue')?.attack?.clipId,
        ).toBe('Idle');
        const source = reference(core, 'blue');
        perform(20, [
          {
            ...envelope(second + 50, 'startup-fatal'),
            interval: {
              from: gameTimeMs(second + 40),
              to: gameTimeMs(second + 60),
            },
            kind: 'body-hit',
            source,
            targetActorId: white().actorId,
          },
        ]);
        expect(frame.snapshot.clocks.gameTimeMs).toBe(second + 50);
        const fatal = pose(frame, 'white');
        expect(fatal.kind).toBe('defeat');
        if (fatal.kind !== 'defeat') throw Error('Missing actual defeat');
        expect(fatal.entry).toEqual(secondPose.epoch);
        const offset =
          frame.snapshot.clocks.presentationTimeMs - fatal.defeatStartedAt;
        expect(offset).toBeGreaterThan(0);
        expect(offset).toBeLessThan(20);
        const deathSeconds = deathClipSeconds(
          required(white().defeatPresentation),
          frame.snapshot.clocks.presentationTimeMs,
        );
        expect(deathSeconds).toBe((offset * 0.25) / 1000);
        trace.push({
          deathClock: {
            entryAt: fatal.entryAt,
            presentationAt: frame.snapshot.clocks.presentationTimeMs,
            presentationStartedAt: fatal.defeatStartedAt,
            offset,
            deathSeconds,
            formula:
              'deathClipSeconds(actual defeatPresentation, actual presentationTimeMs)',
          },
        });
        observe('7 public second-activation death entry', frame);
      } finally {
        for (const resource of owned.reverse())
          cleanup(resource.label, resource.dispose);
        for (const rig of [...rigs.values()])
          cleanup('untransferred-rig', () => rig.dispose());
        cleanup('visible-residency', () => expect(liveVisible).toBe(0));
        receipt.histories.push({ motion, trace, disposed: true });
      }
    }
    expect(publicRows).toBe(10);
    expect(directRows).toBe(4);
    expect(observedCanonicalDispatches).toBe(40);
    expect(reservedB).toBe(86);
    expect(observedBUpdates).toBe(86);
    expect(bCanonicalQueries).toBe(40);
    if (authentic) {
      expect(hCanonicalQueries).toBe(40);
      expect(initializationIds.size).toBe(42);
    }
    expect(visibleCreated).toBe(4);
    expect(visibleDisposed).toBe(4);
    receipt.completed = true;
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    receipt.failure = String(error);
  } finally {
    cleanup('head', () => numeric?.dispose());
    cleanup('pack', () => pack?.dispose());
    cleanup('mixer-spy', () => mixerSpy.mockRestore());
    cleanup('sampler-spy', () => samplerSpy.mockRestore());
    try {
      if (directory && (!authentic || receiptFd !== undefined))
        fs.writeFileSync(
          receiptFd ?? path.join(directory, receiptName),
          JSON.stringify(
            {
              ...receipt,
              policy,
              expectedOutcome:
                authentic && policyVersion === 1
                  ? 'known-domain-rejection-not-motion-acceptance'
                  : 'selected-rows-success',
              gateProvenance:
                policyVersion === 2
                  ? 'explicit-startup-v2-selected-consumer-diagnostic'
                  : 'startup-v1-selected-consumer-diagnostic',
              rawQueries,
              completed: receipt.completed && cleanupErrors.length === 0,
              cleanupErrors,
              publicRows,
              directRows,
              observedCanonicalDispatches,
              observedBUpdates,
              visibleCreated,
              visibleDisposed,
              liveVisible,
              peakVisible,
              reservedB,
              reservedAuthenticHInitialization: 42,
              plannedAllIn: reservedB + observedCanonicalDispatches + 42,
              actualSourceQueries: authentic
                ? observedBUpdates + hCanonicalQueries + initializationIds.size
                : 0,
              authentic,
              authenticInputs,
              bCanonicalQueries,
              hCanonicalQueries,
              initializationIds: [...initializationIds],
            },
            null,
            2,
          ) + '\n',
          { flag: 'wx' },
        );
    } catch (error) {
      cleanupErrors.push('receipt-write: ' + String(error));
      if (!primaryFailed) {
        primaryFailed = true;
        primaryError = error;
      } else {
        cleanup('secondary-error-report', () =>
          console.error('Secondary receipt-write failure:', error),
        );
      }
    } finally {
      if (receiptFd !== undefined)
        cleanup('receipt-file', () => fs.closeSync(receiptFd!));
    }
  }
  if (authentic && policyVersion === 1) {
    assertStartupV1KnownRejection({
      error: primaryError,
      completed: receipt.completed,
      cleanupErrors,
      counts: [
        observedBUpdates,
        hCanonicalQueries,
        initializationIds.size,
        bCanonicalQueries,
        rawQueries.length,
        visibleCreated,
        visibleDisposed,
        liveVisible,
        publicRows,
        directRows,
        observedCanonicalDispatches,
        reservedB,
      ],
      rows: receipt.rows.map((row) => {
        const r = row as { motion: string; name: string };
        return [r.motion, r.name];
      }),
    });
    expect(policy.version).toBe(1);
    const partial = rawQueries.slice(-2);
    expect(partial.map((q) => q.provider)).toEqual(['B', 'B']);
    const [outgoing, incoming] = partial.map((q) => q.sample);
    expect(required(outgoing).query.stamp.binding).toEqual(idle);
    expect(required(incoming).query.stamp.binding).toEqual(
      STARTUP_SOURCES.SideThrustKick.binding,
    );
    expect(required(incoming).query.clipTime).toBe(50);
    for (const q of partial) {
      expect(isStartupPoseEpoch(q.epoch)).toBe(true);
      if (!isStartupPoseEpoch(q.epoch))
        throw Error('Expected v1 startup rejection epoch');
      expect(q.epoch.policy).toEqual(policy);
    }
    const a = required(
      required(outgoing).pose.find((n) => n.id === 'gltf:36'),
    ).q;
    const b = required(
      required(incoming).pose.find((n) => n.id === 'gltf:36'),
    ).q;
    const dot =
      a.reduce((sum, x, i) => sum + x * required(b[i]), 0) /
      (Math.hypot(...a) * Math.hypot(...b));
    expect(dot).toBeLessThan(0);
    expect(dot).toBeGreaterThanOrEqual(-0.5);
    return;
  }
  if (primaryFailed) throw primaryError;
  if (cleanupErrors.length)
    throw Error('Cleanup failure: ' + cleanupErrors.join('; '));
}
test(
  'startup Stage3 source-free causal timetable and shared query observer',
  () => runStartupStage3Observer(false),
  30_000,
);
// Normal CI: passing this case means the precise v1 rejection is preserved.
test(
  'startup Stage3 v1 authentic known SideThrust domain rejection within109',
  () => runStartupStage3Observer(true),
  60_000,
);

test(
  'startup Stage3 v2 source-free causal timetable and shared query observer',
  () => runStartupStage3Observer(false, 2),
  30_000,
);
// Normal CI: explicitly versioned v2 success, never relabels v1 rejection.
test(
  'startup Stage3 v2 authentic selected consumer gate within168',
  () => runStartupStage3Observer(true, 2),
  60_000,
);

// Tiny SYNTHETIC structural adapter, never authentic source or parity evidence.
function startupStage3SyntheticBytes(
  includeRecovery = true,
  includeStartup = true,
) {
  const chunks: Uint8Array[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] =
    [];
  const accessors: {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[] = [];
  let offset = 0;
  const add = (
    values: number[],
    type: string,
    width: number,
    componentType = 5126,
  ) => {
    const raw =
      componentType === 5126
        ? new Float32Array(values)
        : new Uint16Array(values);
    const data = new Uint8Array(raw.buffer);
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    const index = accessors.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    chunks.push(padded);
    offset += padded.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count: values.length / width,
      type,
    });
    return index;
  };
  const position = add([-0.1, 0, 0, 0.1, 0, 0, 0, 0.2, 0], 'VEC3', 3);
  required(accessors[position]).min = [-0.1, 0, 0];
  required(accessors[position]).max = [0.1, 0.2, 0];
  const joints = add([2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0], 'VEC4', 4, 5123);
  const weights = add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 'VEC4', 4);
  const indices = add([0, 1, 2], 'SCALAR', 1, 5123);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const binds = add([...identity, ...identity, ...identity], 'MAT4', 16);
  const times = add([0.25, 1], 'SCALAR', 1);
  const track = (node: number, path: string, values: number[]) => ({
    node,
    path,
    output: add(
      values,
      path === 'rotation' ? 'VEC4' : 'VEC3',
      path === 'rotation' ? 4 : 3,
    ),
  });
  const q = [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const definitions = [
    { name: 'Idle', tracks: [track(2, 'rotation', q)] },
    {
      name: 'Walk',
      tracks: [
        track(0, 'translation', [0.4, 0, 0, 1.4, 0, 0]),
        track(1, 'translation', [0, 0, 0, 0, 0.5, 0]),
        track(4, 'translation', [0, 0, 0, 3, 2, 1]),
        track(4, 'rotation', q),
        track(4, 'scale', [1, 1, 1, 2, 3, 4]),
      ],
    },
    { name: 'Run', tracks: [track(2, 'scale', [1, 1, 1, 2, 2, 2])] },
    { name: 'Jump', tracks: [track(0, 'translation', [0.4, 0, 0, 1.4, 2, 0])] },
  ];
  if (includeRecovery)
    definitions.push({
      name: 'KungFuStraight',
      tracks: [track(2, 'rotation', q)],
    });
  if (includeStartup)
    definitions.push(
      { name: 'SideKick', tracks: [track(2, 'rotation', q)] },
      { name: 'SideThrustKick', tracks: [track(2, 'rotation', q)] },
    );
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: includeRecovery ? [5] : [0, 3, 4] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'pelvis', children: [2] },
      { name: 'hand' },
      { name: 'surface', mesh: 0, skin: 0 },
      { name: 'nonBoneAnimated' },
      ...(includeRecovery
        ? [{ name: 'stage2Hierarchy', children: [0, 3, 4] }]
        : []),
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: position,
              JOINTS_0: joints,
              WEIGHTS_0: weights,
            },
            indices,
          },
        ],
      },
    ],
    skins: [{ joints: [0, 1, 2], inverseBindMatrices: binds, skeleton: 0 }],
    animations: definitions.map((d) => ({
      name: d.name,
      samplers: d.tracks.map((t) => ({
        input: times,
        output: t.output,
        interpolation: 'LINEAR',
      })),
      channels: d.tracks.map((t, index) => ({
        sampler: index,
        target: { node: t.node, path: t.path },
      })),
    })),
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(12 + 8 + jsonLength + 8 + offset);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(32, 20, 20 + jsonLength);
  json.copy(result, 20);
  result.writeUInt32LE(offset, 20 + jsonLength);
  result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  let at = 28 + jsonLength;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return new Uint8Array(result);
}
async function startupStage3SyntheticPack() {
  const { AnimationClip, QuaternionKeyframeTrack } = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { prepareThreeAssetPack } = await import(
    '../../src/assets/threeAssetPack'
  );
  const { prepareSkinBounds } = await import('../../src/assets/skinBounds');
  const { STARTUP_SOURCES, clipId } = await import('../../src/contracts');
  const hash =
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd';
  const policies = (['SideKick', 'SideThrustKick'] as const).map(
    (name, index) => ({
      version: 1 as const,
      clipId: clipId(name),
      sourceSha256: hash,
      mode: STARTUP_SOURCES[name].rootPolicy,
      provenance: {
        manifestSha256:
          'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
        clipPointer: '/clips/' + (index ? 9 : 1),
        supportPointer: index
          ? '/clips/9/support_contacts/support_contacts'
          : '/clips/1/support_contacts/support/0',
      },
    }),
  );
  const deaths = ['DefeatPunch', 'DefeatKick'].map(
    (name) =>
      new AnimationClip(name, 0.5, [
        new QuaternionKeyframeTrack(
          'pelvis.quaternion',
          [0, 0.5],
          [0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        ),
      ]),
  );
  const pack = await prepareThreeAssetPack(
    [startupStage3SyntheticBytes()],
    // Explicit synthetic fixture palette, not an authentic visual approval.
    {
      blue: {
        armorRgb: [0, 0, 1],
        emissiveRgb: [0, 0, 0],
        inlayBaseRgb: [0, 0, 0],
        emissiveStrength: 0,
        sourceSha256: 'b'.repeat(64),
      },
    },
    deaths,
    policies,
    {
      checkpoint: async () => {},
      support: async (template) => prepareSkinBounds(template),
      verifyPolicy: async (policy) => {
        expect(policies).toContainEqual(policy);
      },
      poseOrigin: (name, _source, index) => ({
        sourceSha256:
          name === 'Idle'
            ? 'c5ade077f78d87b33bb4e6aee4d331a8fd0dbfa190d4d5718a87873d3e94774f'
            : name === 'SideKick' || name === 'SideThrustKick'
              ? hash
              : 'a'.repeat(64),
        sourceClipIndex:
          name === 'Idle'
            ? 0
            : name === 'SideKick'
              ? 1
              : name === 'SideThrustKick'
                ? 9
                : index,
      }),
      parse: async (bytes) => {
        const loaded = await new GLTFLoader().parseAsync(
          new Uint8Array(bytes).buffer,
          '',
        );
        for (const name of ['SideKick', 'SideThrustKick'] as const)
          required(
            loaded.animations.find((clip) => clip.name === name),
          ).duration = STARTUP_SOURCES[name].binding.durationMs / 1000;
        required(
          loaded.animations.find((clip) => clip.name === 'Idle'),
        ).duration = 2022.2222805023193 / 1000;
        return loaded;
      },
    },
  );
  for (const name of ['SideKick', 'SideThrustKick'] as const)
    expect(pack.poseBindings!.clips.find((b) => b.clipId === name)).toEqual(
      STARTUP_SOURCES[name].binding,
    );
  return pack;
}

/** Authentic factories only. No trusted test-injection seam is used here. */
async function prepareStartupStage3Authentic(
  owner: {
    ownPack(
      value: Awaited<ReturnType<typeof startupStage3SyntheticPack>>,
    ): void;
    ownHead(
      value: import('../../src/assets/headSurface').SourceHeadProvider,
    ): void;
    initializationIds: Set<string>;
  },
  policyVersion: 1 | 2 = 1,
) {
  if (process.env.STARTUP_SOURCE_FREE_ONLY === '1')
    throw Error('Authentic startup source prohibited in pure control run');
  const fs = await import('node:fs'),
    crypto = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const { preparePinnedSourceHead } = await import(
    '../../src/assets/headSurface'
  );
  const { ANDROID_DERIVED_PACK_V1 } = await import(
    '../../src/assets/derivedPackManifest'
  );
  const { clipId, STARTUP_SOURCES } = await import('../../src/contracts');
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  const checkoutStatus = git('status', '--porcelain', '--untracked-files=no');
  const rootPolicies = (['SideKick', 'SideThrustKick'] as const).map(
    (name, index) => ({
      version: 1 as const,
      clipId: clipId(name),
      sourceSha256:
        '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
      mode: STARTUP_SOURCES[name].rootPolicy,
      provenance: {
        manifestSha256:
          'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
        clipPointer: '/clips/' + (index ? 9 : 1),
        supportPointer: index
          ? '/clips/9/support_contacts/support_contacts'
          : '/clips/1/support_contacts/support/0',
      },
    }),
  );
  const derivedBytes = fs.readFileSync(
    'public/game-assets/android/derived-pack-v1.glb',
  );
  const artifactBytes = fs.readFileSync(
    'public/game-assets/android/runtime-artifact-v1.json',
  );
  const hash = (bytes: Uint8Array) =>
    crypto.createHash('sha256').update(bytes).digest('hex');
  const controller = new AbortController(),
    start = performance.now();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const pack = await createPinnedDerivedThreeAssetPack({
      derivedBytes,
      artifactBytes,
      rootPolicies,
      signal: controller.signal,
    });
    owner.ownPack(pack);
    const bPreparationMs = performance.now() - start;
    const head = await preparePinnedSourceHead({
      derivedBytes,
      rootPolicies,
      signal: controller.signal,
      checkpoint: async (stage) => {
        if (stage.startsWith('clip:')) {
          const id = stage.slice(5);
          if (
            owner.initializationIds.has(id) ||
            owner.initializationIds.size >= 42
          )
            throw Error('Unexpected H initialization checkpoint');
          owner.initializationIds.add(id);
        }
      },
    });
    owner.ownHead(head);
    expect([...owner.initializationIds].sort()).toEqual(
      ANDROID_DERIVED_PACK_V1.clips.map((c) => c.name).sort(),
    );
    expect(performance.now() - start).toBeLessThan(30_000);
    for (const name of ['SideKick', 'SideThrustKick'] as const) {
      expect(
        required(pack.poseBindings).clips.find((b) => b.clipId === name),
      ).toEqual(STARTUP_SOURCES[name].binding);
      expect(head.poseBindings.clips.find((b) => b.clipId === name)).toEqual(
        STARTUP_SOURCES[name].binding,
      );
    }
    return {
      commit,
      checkoutStatus,
      policyVersion,
      executedHarnessSha256: hash(
        fs.readFileSync('tests/integration/stampedConsumerIntegration.test.ts'),
      ),
      tree: git('rev-parse', 'HEAD^{tree}'),
      harnessBlob: git(
        'rev-parse',
        'HEAD:tests/integration/stampedConsumerIntegration.test.ts',
      ),
      derivedSha256: hash(derivedBytes),
      artifactSha256: hash(artifactBytes),
      headReference: {
        meshIndex: head.descriptor.meshIndex,
        headJointIndex: head.descriptor.headJointIndex,
        headAttachmentAtBind: head.descriptor.headAttachmentAtBind,
        referenceToActorAtBind: head.descriptor.referenceToActorAtBind,
      },
      rootPolicies,
      bPreparationMs,
      totalPreparationMs: performance.now() - start,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const startupV1KnownRows = [
  '2 public interior',
  '1 exact start direct',
  '3 left end direct',
  '4 public right end',
  '5 public reverse interior',
  '6 public exact repeat',
  '7 public second-activation death entry',
].map((name) => ['SideKick', name]);
function assertStartupV1KnownRejection(value: {
  error: unknown;
  completed: boolean;
  cleanupErrors: readonly string[];
  counts: readonly number[];
  rows: readonly (readonly string[])[];
}) {
  expect(value.error).toBeInstanceOf(Error);
  expect((value.error as Error).message).toBe(
    'Unsupported fixed-lift crossing/antipodal domain',
  );
  expect(value.completed).toBe(false);
  expect(value.cleanupErrors).toEqual([]);
  expect(value.counts).toEqual([47, 20, 42, 22, 42, 2, 2, 0, 6, 2, 20, 43]);
  expect(value.rows).toEqual(startupV1KnownRows);
}
test('startup Stage3 known rejection classifier accepts only precise ledger', () => {
  assertStartupV1KnownRejection({
    error: new Error('Unsupported fixed-lift crossing/antipodal domain'),
    completed: false,
    cleanupErrors: [],
    counts: [47, 20, 42, 22, 42, 2, 2, 0, 6, 2, 20, 43],
    rows: startupV1KnownRows,
  });
});
test('startup Stage3 known rejection classifier rejects unrelated errors and cleanup failure', () => {
  const base = {
    error: new Error('Unsupported fixed-lift crossing/antipodal domain'),
    completed: false,
    cleanupErrors: [] as string[],
    counts: [47, 20, 42, 22, 42, 2, 2, 0, 6, 2, 20, 43],
    rows: startupV1KnownRows,
  };
  expect(() =>
    assertStartupV1KnownRejection({
      ...base,
      error: new Error('setup failure'),
    }),
  ).toThrow();
  expect(() =>
    assertStartupV1KnownRejection({
      ...base,
      cleanupErrors: ['receipt-write failure'],
    }),
  ).toThrow();
});
test('startup Stage3 known rejection classifier rejects partial rows or altered counts', () => {
  const base = {
    error: new Error('Unsupported fixed-lift crossing/antipodal domain'),
    completed: false,
    cleanupErrors: [],
    counts: [47, 20, 42, 22, 42, 2, 2, 0, 6, 2, 20, 43],
    rows: startupV1KnownRows,
  };
  expect(() =>
    assertStartupV1KnownRejection({
      ...base,
      rows: startupV1KnownRows.slice(0, 6),
    }),
  ).toThrow();
  expect(() =>
    assertStartupV1KnownRejection({ ...base, counts: [0] }),
  ).toThrow();
});

/** Independent diagnostic algebra, never invokes source samplers or production
 * blendPose/composePoseMatrices. Raw q radius and positive scale are retained. */
function startupStage3IndependentBlend(
  a: import('../../src/assets/poseRecipeMath').LocalPose,
  b: import('../../src/assets/poseRecipeMath').LocalPose,
  weight: number,
  policyVersion: 1 | 2 = 1,
): import('../../src/assets/poseRecipeMath').LocalPose {
  expect(a.length).toBe(b.length);
  return a.map((left, index) => {
    const right = required(b[index]);
    expect([left.id, left.parent]).toEqual([right.id, right.parent]);
    if (policyVersion === 1 && weight === 0) return left;
    if (policyVersion === 1 && weight === 1) return right;
    const ra = Math.hypot(...left.q),
      rb = Math.hypot(...right.q);
    expect(ra).toBeGreaterThan(Math.SQRT1_2);
    expect(rb).toBeGreaterThan(Math.SQRT1_2);
    const u = left.q.map((v) => v / ra),
      v = right.q.map((v) => v / rb);
    const dot = u.reduce((sum, x, i) => sum + x * required(v[i]), 0);
    expect(dot).toBeGreaterThanOrEqual(policyVersion === 2 ? -0.5 : 0);
    if (weight === 0) return left;
    if (weight === 1) return right;
    const angle = Math.acos(Math.min(1, dot));
    const l =
      angle < 1e-8
        ? 1 - weight
        : Math.sin((1 - weight) * angle) / Math.sin(angle);
    const r =
      angle < 1e-8 ? weight : Math.sin(weight * angle) / Math.sin(angle);
    const radius = ra * (1 - weight) + rb * weight;
    return {
      id: left.id,
      parent: left.parent,
      t: left.t.map((x, i) => x * (1 - weight) + required(right.t[i]) * weight),
      s: left.s.map((x, i) => x * (1 - weight) + required(right.s[i]) * weight),
      q: u.map((x, i) => radius * (l * x + r * required(v[i]))),
    };
  });
}
function startupStage3RawLocalMatrix(node: {
  t: readonly number[];
  q: readonly number[];
  s: readonly number[];
}) {
  const matrix = new OracleMatrix4().compose(
    new OracleVector3().fromArray(node.t),
    new OracleQuaternion().fromArray(node.q),
    new OracleVector3().fromArray(node.s),
  );
  expect(matrix.elements.every(Number.isFinite)).toBe(true);
  return matrix;
}

test('startup Stage3 oracle raw identity control', () => {
  expect(
    startupStage3RawLocalMatrix({
      t: [0, 0, 0],
      q: [0, 0, 0, 1],
      s: [1, 1, 1],
    }).toArray(),
  ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});
test('startup Stage3 oracle raw nonunit anisotropic control', () => {
  const q = [1, 2, 3, 4];
  // Raw-compose arithmetic control only, not an admitted runtime blend sample.
  // Hand-expanded raw-q rotation polynomial, columns scaled by 2,3,5.
  expect(
    startupStage3RawLocalMatrix({ t: [7, 8, 9], q, s: [2, 3, 5] }).toArray(),
  ).toEqual([-50, 56, -20, 0, -60, -57, 60, 0, 110, 20, -45, 0, 7, 8, 9, 1]);
  expect(q).toEqual([1, 2, 3, 4]);
});
test('startup Stage3 oracle raw signed-zero endpoint control', () => {
  const node = {
    id: 'root',
    parent: null,
    t: [-0, 0, -0],
    q: [-0, 0, -0, 1],
    s: [1, 1, 1],
  };
  for (const weight of [0, 1]) {
    const selected = required(
      startupStage3IndependentBlend([node], [node], weight)[0],
    );
    expect(Object.is(selected.q[0], -0)).toBe(true);
    expect(Object.is(selected.q[2], -0)).toBe(true);
    expect(Object.is(selected.t[0], -0)).toBe(true);
    const matrix = startupStage3RawLocalMatrix(selected).toArray();
    const expected = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(matrix.every((value, index) => value === expected[index])).toBe(
      true,
    );
    expect(Object.is(selected.q[0], -0)).toBe(true);
  }
});

function startupStage3AssertObserved(input: {
  f: import('../../src/contracts').CommittedFrame;
  direct:
    | {
        at: number;
        side: 'left' | 'right';
        white: import('../../src/contracts').PoseEpoch;
      }
    | undefined;
  actors: readonly {
    color: ActorColor;
    requestedEpoch: import('../../src/contracts').PoseEpoch;
    queryAt: import('../../src/contracts').GameTimeMs;
    hSample:
      | import('../../src/assets/headSurface').SourceHeadSample
      | undefined;
  }[];
  rigs: Map<
    ActorColor,
    import('../../src/assets/actorAnimator').ActorRig<import('three').Object3D>
  >;
  numeric: import('../../src/assets/headSurface').SourceHeadProvider;
  raw: readonly {
    provider: 'B' | 'H';
    epoch: import('../../src/contracts').PoseEpoch;
    sample: import('../../src/assets/recoveryDiagnostic').CanonicalPoseSnapshot;
  }[];
  outerBaselines: Map<ActorColor, readonly number[]>;
  Matrix4: typeof import('three').Matrix4;
  SkinnedMesh: typeof import('three').SkinnedMesh;
}) {
  const { Matrix4, SkinnedMesh } = input;
  const maxError = (a: readonly number[], b: readonly number[]) => {
    expect(a.length).toBe(b.length);
    return Math.max(...a.map((x, i) => Math.abs(x - required(b[i]))));
  };
  let maximumAbsoluteError = 0;
  const metrics: unknown[] = [];
  const compare = (a: readonly number[], b: readonly number[]) => {
    const error = maxError(a, b);
    maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
    expect(error).toBeLessThan(1e-10);
  };
  const adjustment = new Matrix4()
    .fromArray(input.numeric.descriptor.headAttachmentAtBind)
    .invert()
    .multiply(
      new Matrix4().fromArray(input.numeric.descriptor.referenceToActorAtBind),
    );
  for (const actor of input.actors) {
    const epoch = actor.requestedEpoch;
    const selected = input.raw.filter(
      (item) => JSON.stringify(item.epoch) === JSON.stringify(epoch),
    );
    const b = selected
        .filter((item) => item.provider === 'B')
        .map((item) => item.sample),
      h = selected
        .filter((item) => item.provider === 'H')
        .map((item) => item.sample);
    const startup = isStartupPoseEpoch(epoch);
    expect(b.length).toBe(startup ? 2 : 1);
    expect(h.length).toBe(b.length);
    for (let sample = 0; sample < b.length; sample++) {
      const full = required(b[sample]),
        closure = required(h[sample]);
      expect(full.query).toEqual(closure.query);
      const byId = new Map(full.pose.map((node) => [node.id, node]));
      for (const node of closure.pose) {
        const other = required(byId.get(node.id));
        compare(node.t, other.t);
        compare(node.q, other.q);
        compare(node.s, other.s);
        // H closure may omit generated loader scaffolding, but cannot change
        // a source-node parent when that parent appears in both layouts.
        if (node.parent !== null) expect(other.parent).toBe(node.parent);
      }
    }
    const weight = startup
      ? (actor.queryAt - epoch.startMs) / (epoch.endMs - epoch.startMs)
      : 1;
    const expected = startup
      ? startupStage3IndependentBlend(
          required(b[0]).pose,
          required(b[1]).pose,
          weight,
          epoch.policy.version,
        )
      : required(b[0]).pose;
    const rig = required(input.rigs.get(actor.color));
    const visible: import('three').Object3D[] = [];
    rig.node.traverse((part) => {
      if (part !== rig.node) visible.push(part);
    });
    expect(visible.length).toBe(expected.length);
    const idByNode = new Map(
      visible.map((node, index) => [node, required(expected[index]).id]),
    );
    const worlds = new Map<string, InstanceType<typeof Matrix4>>();
    const layer = new Matrix4();
    if (startup)
      layer.makeRotationY(
        (epoch.basis.oldYaw - epoch.basis.admittedYaw) * (1 - weight),
      );
    const outer = new Matrix4().fromArray(
      required(input.outerBaselines.get(actor.color)),
    );
    const model = layer.clone().multiply(outer);
    const actorState = required(
      input.f.snapshot.actors.find((a) => a.color === actor.color),
    );
    const isDeath = actorState.defeated && !input.direct;
    for (let index = 0; index < expected.length; index++) {
      const node = required(expected[index]),
        part = required(visible[index]);
      const parent =
        part.parent === rig.node ? null : idByNode.get(required(part.parent));
      expect(node.parent).toBe(parent);
      // Three compose accepts raw nonunit q; never normalize or decompose.
      const local = startupStage3RawLocalMatrix(node);
      worlds.set(
        node.id,
        node.parent === null
          ? model.clone().multiply(local)
          : required(worlds.get(node.parent)).clone().multiply(local),
      );
      if (!isDeath) {
        if (startup && (weight === 0 || weight === 1)) {
          expect(part.position.toArray()).toEqual(node.t);
          expect(part.quaternion.toArray()).toEqual(node.q);
          expect(part.scale.toArray()).toEqual(node.s);
        } else {
          compare(part.position.toArray(), node.t);
          compare(part.quaternion.toArray(), node.q);
          compare(part.scale.toArray(), node.s);
        }
      }
    }
    compare(rig.node.matrix.toArray(), model.toArray());
    rig.node.parent?.updateMatrixWorld(true);
    rig.node.updateMatrixWorld(true);
    const meshes = visible.filter(
      (part): part is import('three').SkinnedMesh =>
        part instanceof SkinnedMesh,
    );
    const mesh = required(meshes[input.numeric.descriptor.meshIndex]),
      head = required(
        mesh.skeleton.bones[input.numeric.descriptor.headJointIndex],
      );
    expect(idByNode.get(head)).toBe('gltf:0');
    const expectedHead = required(worlds.get('gltf:0'))
      .clone()
      .multiply(adjustment);
    const sample = required(actor.hSample);
    if (sample.kind !== 'transform')
      throw Error('Actual H unavailable: ' + sample.reason);
    const hWithOuter = layer
      .clone()
      .multiply(outer)
      .multiply(layer.clone().invert())
      .multiply(new Matrix4().fromArray(sample.matrix));
    compare(expectedHead.toArray(), hWithOuter.toArray());
    if (!isDeath) {
      const displayed = rig.node.parent
        ? rig.node.parent.matrixWorld.clone().invert()
        : new Matrix4();
      displayed.multiply(head.matrixWorld).multiply(adjustment);
      compare(displayed.toArray(), expectedHead.toArray());
    }
    // Moving death is NOT compared to the immutable H entry. Its outer layer
    // remains frozen and support is inspected separately from entry head parity.
    let supportMetrics: unknown;
    if (isDeath) {
      const support = required(rig.defeatPoseSupport?.());
      // All-vertex matrix oracle uses existing geometry only. Attached inverse
      // is recomputed at reconstructed ENTRY, never borrowed from moving death.
      const transform = (
        m: InstanceType<typeof Matrix4>,
        v: readonly number[],
      ) => {
        const e = m.elements;
        return [
          e[0]! * v[0]! + e[4]! * v[1]! + e[8]! * v[2]! + e[12]!,
          e[1]! * v[0]! + e[5]! * v[1]! + e[9]! * v[2]! + e[13]!,
          e[2]! * v[0]! + e[6]! * v[1]! + e[10]! * v[2]! + e[14]!,
        ];
      };
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      let vertices = 0;
      for (const skinned of meshes) {
        const meshWorld = required(worlds.get(required(idByNode.get(skinned))));
        const inverse =
          skinned.bindMode === 'attached'
            ? meshWorld.clone().invert()
            : skinned.bindMatrixInverse;
        const post = meshWorld.clone().multiply(inverse);
        const positions = skinned.geometry.getAttribute('position'),
          joints = skinned.geometry.getAttribute('skinIndex'),
          weights = skinned.geometry.getAttribute('skinWeight');
        const bones = skinned.skeleton.bones.map((bone, index) =>
          required(worlds.get(required(idByNode.get(bone))))
            .clone()
            .multiply(required(skinned.skeleton.boneInverses[index])),
        );
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const bound = transform(skinned.bindMatrix, [
              positions.getX(vertex),
              positions.getY(vertex),
              positions.getZ(vertex),
            ]),
            value = [0, 0, 0];
          for (let component = 0; component < 4; component++) {
            const weight = weights.getComponent(vertex, component);
            if (weight === 0) continue;
            const posed = transform(
              required(bones[joints.getComponent(vertex, component)]),
              bound,
            );
            for (let axis = 0; axis < 3; axis++)
              value[axis] = value[axis]! + weight * posed[axis]!;
          }
          const posed = transform(post, value);
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis]!, posed[axis]!);
            max[axis] = Math.max(max[axis]!, posed[axis]!);
          }
          vertices++;
        }
      }
      compare([support.entryLocalMinY], [min[1]!]);
      supportMetrics = {
        vertices,
        entryMin: min,
        entryMax: max,
        reportedEntryMinY: support.entryLocalMinY,
      };
      expect(Number.isFinite(support.entryLocalMinY)).toBe(true);
      expect(
        Object.values(support.currentLocalBounds)
          .flatMap((p) => Object.values(p))
          .every(Number.isFinite),
      ).toBe(true);
    }
    metrics.push({
      color: actor.color,
      maximumAbsoluteError,
      sourceNodeCount: expected.length,
      rawQuaternionNormRange: [
        Math.min(...expected.map((n) => Math.hypot(...n.q))),
        Math.max(...expected.map((n) => Math.hypot(...n.q))),
      ],
      outerBaseline: outer.toArray(),
      layer: layer.toArray(),
      support: supportMetrics,
      headScope: isDeath ? 'frozen-entry-only' : 'current',
      exactEndpoint: startup && (weight === 0 || weight === 1),
    });
  }
  return {
    maximumAbsoluteError,
    actors: metrics,
    tolerance: 1e-10,
    noExtraSourceQueries: true,
  };
}

/** SOURCE-FREE integration only: actual A/B/C/D public composition, synthetic
 * descriptor/CPU staged poses, and an observing renderer double. No source pack,
 * mixer, WebGL, native clip, recovery artwork or device acceptance is implied. */
async function setupSourceFreeSceneJoin() {
  const { AnimationMixer, Group, Matrix4, Quaternion, Vector3 } = await import(
    'three'
  );
  const { clipId, durationMs } = await import('../../src/contracts');
  const { fixtureCatalog } = await import('../core/fixtures/scenarios');
  const { createPoseFrameDriver, RECOVERY_FRAME_CAPABILITY } = await import(
    '../../src/assets/poseFramePreparation'
  );
  type Frame = import('../../src/contracts').CommittedFrame;
  type Request =
    import('../../src/assets/poseFramePreparation').PoseFrameRequest;
  type Rig = import('../../src/assets').ActorRig<import('three').Object3D>;
  const synthetic = fixtureCatalog();
  const motions: import('../../src/assets').MotionAsset[] = synthetic.catalog
    .list()
    .map((definition) => ({
      definition,
      shapes: [
        {
          shapeId: 'synthetic',
          keys: [0, definition.durationMs].map((at) => ({
            atMs: durationMs(at),
            volume: {
              kind: 'sphere' as const,
              center: { x: 0, y: 100, z: 0 },
              radiusM: 0.001,
            },
          })),
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'spatial-movement' as const,
          verticalOwner: 'spatial-jump' as const,
        },
      ],
    }));
  const locomotion = {
    idle: clipId('SCENE-TEST-ONLY:idle'),
    walk: clipId('SCENE-TEST-ONLY:walk'),
    run: clipId('SCENE-TEST-ONLY:run'),
    jump: clipId('SCENE-TEST-ONLY:jump'),
  };
  const descriptor: import('../../src/contracts').PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'SCENE-TEST-ONLY:synthetic-bindings-not-authentic-source',
    locomotion,
    clips: [
      ...Object.values(locomotion).map((id) => ({
        clipId: id,
        durationMs: durationMs(1000),
        sourceBindingId: `SCENE-TEST-ONLY:${id}`,
      })),
      ...motions.map(({ definition }) => ({
        clipId: definition.clipId,
        durationMs: definition.durationMs,
        sourceBindingId: `SCENE-TEST-ONLY:${definition.clipId}`,
      })),
    ],
  };
  const root = document.createElement('main');
  document.body.append(root);
  const noSourceEvaluation = vi
    .spyOn(AnimationMixer.prototype, 'update')
    .mockImplementation(() => {
      throw Error(
        'Source-free scene join must never evaluate source animation',
      );
    });
  const rigs = new Map<
    ActorColor,
    {
      rig: Rig;
      node: InstanceType<typeof Group>;
      bone: InstanceType<typeof Group>;
      tip: InstanceType<typeof Group>;
      baseline: number[];
    }
  >();
  const requests: Array<{ color: ActorColor; request: Request }> = [];
  const events: string[] = [];
  const frames: Frame[] = [];
  const drawn: Array<{
    frame: Frame;
    aspect: number;
    actors: Array<{ color: ActorColor; world: number[] }>;
  }> = [];
  const bases: import('../../src/contracts').MovementBasisSnapshot[] = [];
  let drawing: Frame | undefined;
  const transform = (node: import('three').Object3D) => ({
    p: node.position.toArray(),
    q: node.quaternion.toArray(),
    s: node.scale.toArray(),
  });
  const closeMatrix = (
    actual: readonly number[],
    expected: readonly number[],
  ) => {
    expect(actual).toHaveLength(16);
    actual.forEach((entry, index) => {
      expect(entry).toBeCloseTo(required(expected[index]), 10);
    });
  };
  const makeRig = (color: ActorColor): Rig => {
    const node = new Group(),
      bone = new Group(),
      tip = new Group();
    node.name = `SCENE-TEST-ONLY:rig:${color}`;
    node.position.set(0.11, 0.07, -0.13);
    node.rotation.set(0.1, -0.2, 0.03);
    node.scale.set(1.1, 0.9, 1.2);
    node.add(bone);
    bone.add(tip);
    node.updateMatrix();
    const baseline = node.matrix.toArray();
    let disposed = false;
    const poseFrame = createPoseFrameDriver(
      (request) => {
        if (request.kind !== 'living' || 'kind' in request.epoch)
          throw Error(
            'Source-free scene fixture accepts canonical living epochs only',
          );
        expect(request.epoch.binding.sourceBindingId).toBe(
          `SCENE-TEST-ONLY:${request.epoch.binding.clipId}`,
        );
        requests.push({ color, request });
        events.push(`prepare:${color}:${node.parent ? 'mounted' : 'detached'}`);
        const mode = ['idle', 'walk', 'run', 'jump'].indexOf(
          request.epoch.mode,
        );
        if (mode < 0) throw Error('Unexpected source-free combat pose');
        return {
          pose: [
            {
              id: 'bone',
              parent: null,
              t: [0.2 + request.at / 1000, 0.5 + mode / 10, -0.1],
              q: new Quaternion()
                .setFromAxisAngle(new Vector3(0, 1, 0), mode / 5)
                .toArray(),
              s: [1.05, 0.95, 1.1],
            },
            {
              id: 'tip',
              parent: 'bone',
              t: [0, 0.3, 0.2],
              q: [0, 0, 0, 1],
              s: [1, 1, 1],
            },
          ],
        };
      },
      (result) => {
        const presentation = required(node.parent),
          anchor = required(presentation.parent);
        const parents = [transform(anchor), transform(presentation)];
        for (const [index, part] of [bone, tip].entries()) {
          const value = required(result.pose[index]);
          part.position.fromArray(value.t);
          part.quaternion.fromArray(value.q);
          part.scale.fromArray(value.s);
        }
        expect([transform(anchor), transform(presentation)]).toEqual(parents);
        expect(node.matrix.toArray()).toEqual(baseline);
        events.push(`apply:${color}:mounted`);
      },
      () => {
        if (disposed) throw Error('Source-free rig disposed');
      },
    );
    const rig: Rig = {
      node,
      poseFrame,
      seek() {
        throw Error('Source-free scene join must not use legacy seek');
      },
      seekPose() {
        throw Error('Source-free scene join must use staged preparation');
      },
      seekDefeat() {
        throw Error('No source-free scene defeat acceptance');
      },
      setEmissiveEnabled() {},
      dispose() {
        if (!disposed) {
          disposed = true;
          poseFrame.dispose();
          events.push(
            `dispose:${color}:${node.parent ? 'mounted' : 'detached'}`,
          );
        }
      },
    };
    rigs.set(color, { rig, node, bone, tip, baseline });
    events.push(`create:${color}`);
    return rig;
  };
  const layout = {
    ...SceneModule.createParisStreetLayout(),
    vehicles: [],
    objects: [],
    actorSpawns: {
      ...SceneModule.createParisStreetLayout().actorSpawns,
      white: { x: 0.7, y: 0, z: -0.8 },
    },
  };
  const actualCreateScene = SceneModule.createSceneAdapter;
  const sceneSpy = vi
    .spyOn(SceneModule, 'createSceneAdapter')
    .mockImplementation((...args) => {
      const actual = actualCreateScene(...args);
      return {
        ...actual,
        beginMovementSession(id) {
          const basis = actual.beginMovementSession(id);
          bases.push(basis);
          return basis;
        },
        render(frame) {
          drawing = frame;
          frames.push(frame);
          actual.render(frame);
        },
      };
    });
  const viewport = {
    widthCssPx: 400,
    heightCssPx: 800,
    offsetLeftCssPx: 0,
    offsetTopCssPx: 0,
    devicePixelRatio: 1,
    safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const game = createIntegratedGame(root, {
    sessionId: 'source-free-scene-join',
    seed: 1,
    stepMs: 20,
    viewport,
    posePolicy: {
      version: 1,
      mode: 'deterministic-pose-v1',
      recovery: RECOVERY_FRAME_CAPABILITY,
    },
    configuration: {
      moves: synthetic.moves,
      layout,
      world: { vehicles: [], objects: [] },
      async loadAssets() {
        return {
          motions,
          animator: {
            poseBindings: descriptor,
            recoveryCapability: RECOVERY_FRAME_CAPABILITY,
            locomotionClips: locomotion,
            clipDuration(id) {
              return id.startsWith('Defeat')
                ? durationMs(500)
                : descriptor.clips.find((entry) => entry.clipId === id)
                    ?.durationMs;
            },
            create: makeRig,
            stageActor(color) {
              const rig = makeRig(color);
              let transferred = false;
              return {
                poseFrame: required(rig.poseFrame),
                materialize() {
                  if (transferred)
                    throw Error('Synthetic stage already transferred');
                  transferred = true;
                  return rig;
                },
                dispose() {
                  if (!transferred) rig.dispose();
                },
              };
            },
            dispose() {
              events.push('pack:dispose');
            },
          },
        };
      },
    },
    createRenderer: () => ({
      domElement: document.createElement('canvas'),
      setPixelRatio() {},
      setSize() {},
      dispose() {},
      render(scene, camera) {
        const frame = required(drawing);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        const actors: Array<{ color: ActorColor; world: number[] }> = [];
        for (const [color, { node, bone, tip, baseline }] of rigs) {
          if (!node.parent) continue;
          const state = required(
            frame.snapshot.actors.find((actor) => actor.color === color),
          );
          const spatial = required(
            frame.spatial.actors.find(
              (actor) => actor.actorId === state.actorId,
            ),
          );
          const presentation = node.parent,
            anchor = required(presentation.parent);
          expect(anchor.parent).toBe(scene);
          expect(anchor.name).toBe(`actor-anchor:${state.actorId}`);
          expect(presentation.name).toBe(`actor-presentation:${state.actorId}`);
          expect(anchor.visible).toBe(true);
          expect(anchor.position.toArray()).toEqual([
            spatial.position.x,
            spatial.position.y,
            spatial.position.z,
          ]);
          expect(presentation.position.toArray()).toEqual([0, 0, 0]);
          expect(presentation.quaternion.toArray()).toEqual([0, 0, 0, 1]);
          expect(presentation.scale.toArray()).toEqual([1, 1, 1]);
          const expectedAnchor = new Matrix4().compose(
            new Vector3(
              spatial.position.x,
              spatial.position.y,
              spatial.position.z,
            ),
            new Quaternion().setFromAxisAngle(
              new Vector3(0, 1, 0),
              Math.atan2(spatial.facing.x, spatial.facing.z),
            ),
            new Vector3(1, 1, 1),
          );
          closeMatrix(anchor.matrixWorld.toArray(), expectedAnchor.toArray());
          closeMatrix(node.matrix.toArray(), baseline);
          closeMatrix(
            tip.matrixWorld.toArray(),
            expectedAnchor
              .multiply(presentation.matrix)
              .multiply(new Matrix4().fromArray(baseline))
              .multiply(bone.matrix)
              .multiply(tip.matrix)
              .toArray(),
          );
          const request = required(
            requests.filter((entry) => entry.color === color).at(-1),
          ).request;
          expect(request.kind).toBe('living');
          if (request.kind !== 'living' || spatial.pose?.kind !== 'living')
            throw Error('Missing canonical scene frame');
          expect(request.epoch).toEqual(spatial.pose.living);
          expect(request.at).toBe(frame.snapshot.clocks.gameTimeMs);
          expect(request.side).toBe('right');
          expect(state.attack).toBeNull();
          expect(state.defeated).toBe(false);
          actors.push({ color, world: tip.matrixWorld.toArray() });
        }
        expect(frame.snapshot.actors.map((actor) => actor.hp)).toEqual([
          500, 500, 500, 500, 700,
        ]);
        drawn.push({
          frame,
          aspect: (camera as import('three').PerspectiveCamera).aspect,
          actors,
        });
      },
    }),
  });
  const pointer = (
    target: EventTarget,
    type: string,
    id: number,
    x = 100,
    y = 200,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: id });
    target.dispatchEvent(event);
  };
  const click = (label: string) =>
    required(
      [...root.querySelectorAll('button')].find(
        (button) => button.textContent === label,
      ),
    ).click();
  const player = () => {
    const frame = required(frames.at(-1));
    const id = required(
      frame.snapshot.actors.find((actor) => actor.color === 'white'),
    ).actorId;
    return required(frame.spatial.actors.find((actor) => actor.actorId === id));
  };
  const move = (id: number, delta: number, fresh = false) => {
    if (fresh)
      pointer(required(root.querySelector('.nt-swipe')), 'pointerdown', id);
    pointer(document, 'pointermove', id, 100 + delta);
  };
  return {
    game,
    root,
    requests,
    events,
    rigs,
    frames,
    drawn,
    bases,
    viewport,
    player,
    click,
    pointer,
    move,
    async start() {
      await game.start();
      game.dispatch({
        type: 'StartRequested',
        runId: required(game.read()).runId,
      });
    },
    dispose() {
      try {
        game.dispose();
      } finally {
        sceneSpy.mockRestore();
        root.remove();
        try {
          expect(noSourceEvaluation).not.toHaveBeenCalled();
        } finally {
          noSourceEvaluation.mockRestore();
        }
      }
    },
  };
}

test('source-free scene join prepares both actors before mounting into actual C anchors', async () => {
  const h = await setupSourceFreeSceneJoin();
  try {
    await h.game.start();
    expect(h.game.read()?.phase).toBe('ready');
    expect(h.frames.map((frame) => frame.snapshot.phase)).toEqual([
      'loading',
      'ready',
    ]);
    expect(h.drawn.map((draw) => draw.actors.length)).toEqual([0, 2]);
    expect(h.requests).toHaveLength(2);
    const firstApply = h.events.findIndex((event) =>
      event.startsWith('apply:'),
    );
    expect(h.events.indexOf('prepare:white:detached')).toBeLessThan(firstApply);
    expect(h.events.indexOf('prepare:blue:detached')).toBeLessThan(firstApply);
    expect(h.player().position).toEqual({ x: 0.7, y: 0, z: -0.8 });
    h.game.dispose();
    expect(h.events.slice(-3)).toEqual([
      'dispose:white:detached',
      'dispose:blue:detached',
      'pack:dispose',
    ]);
  } finally {
    h.dispose();
  }
}, 5000);

test('source-free scene join freezes the ten-frame walk run pause and fresh jump input plan', async () => {
  const h = await setupSourceFreeSceneJoin();
  try {
    await h.start();
    h.move(1, 16, true);
    h.game.advance(20);
    expect(h.player().locomotion).toBe('walk');
    const walking = h.player();
    h.move(1, 64);
    h.game.advance(20);
    expect(h.player().locomotion).toBe('run');
    expect(h.player().facing.x).not.toBe(0);
    const beforePause = h.player().position;
    h.click('設定');
    h.game.advance(1000);
    h.click('設定を閉じる');
    h.move(1, 64);
    h.game.advance(20);
    expect(h.player().locomotion).toBe('idle');
    expect(h.player().position).toEqual(beforePause);
    h.move(2, 16, true);
    h.click('ジャンプ');
    h.game.advance(20);
    expect(h.player().locomotion).toBe('jump');
    expect(h.player().position.y).toBeGreaterThan(0);
    const airborne = h.player().position;
    expect(
      Math.hypot(airborne.x - beforePause.x, airborne.z - beforePause.z),
    ).toBeGreaterThan(0);
    h.pointer(document, 'pointerup', 2);
    h.game.advance(20);
    expect(h.player().position.x).toBeCloseTo(airborne.x, 10);
    expect(h.player().position.z).toBeCloseTo(airborne.z, 10);
    const rendered = h.drawn.filter((draw) => draw.actors.length);
    expect(
      rendered.map((draw) => draw.frame.snapshot.clocks.gameTimeMs),
    ).toEqual([0, 0, 20, 40, 40, 40, 40, 60, 80, 100]);
    expect(h.drawn).toHaveLength(11);
    expect(h.requests).toHaveLength(20);
    expect(h.events.filter((event) => event.startsWith('apply:'))).toHaveLength(
      20,
    );
    expect(walking.pose).toMatchObject({
      kind: 'living',
      living: {
        mode: 'walk',
        startedAt: 20,
        binding: { sourceBindingId: 'SCENE-TEST-ONLY:SCENE-TEST-ONLY:walk' },
      },
    });
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.dispose();
  }
}, 5000);

test('source-free scene join maps the real jump apex and landing without double Y transport', async () => {
  const h = await setupSourceFreeSceneJoin();
  try {
    await h.start();
    h.click('ジャンプ');
    for (let step = 1; step <= 57; step++) {
      h.game.advance(20);
      if (step === 1) {
        expect(h.player().grounded).toBe(false);
        expect(h.player().locomotion).toBe('jump');
      }
      if (step === 28) expect(h.player().position.y).toBeGreaterThan(1.5);
    }
    expect(h.player().grounded).toBe(true);
    expect(h.player().position.y).toBe(0);
    expect(h.player().locomotion).toBe('idle');
    expect(h.player().pose).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: 1140 },
    });
    expect(h.game.read()?.clocks.gameTimeMs).toBe(1140);
    expect(h.drawn).toHaveLength(60);
    expect(h.requests).toHaveLength(118);
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.dispose();
  }
}, 5000);

test('source-free scene join cancels the held gesture on viewport rotation and reacquires C basis', async () => {
  const h = await setupSourceFreeSceneJoin();
  try {
    await h.start();
    h.move(1, 64, true);
    h.game.advance(20);
    const atRotation = h.player().position;
    const oldBasis = required(
      h.bases.find((basis) => basis.sessionId.includes(':gesture:')),
    );
    const saved = JSON.stringify(oldBasis);
    h.game.updateViewport({ ...h.viewport, widthCssPx: 800, heightCssPx: 400 });
    expect(h.drawn.at(-1)?.aspect).toBe(2);
    h.move(1, 64);
    h.game.advance(20);
    expect(h.player().position).toEqual(atRotation);
    expect(h.player().locomotion).toBe('idle');
    h.move(2, 64, true);
    h.game.advance(20);
    expect(h.player().locomotion).toBe('run');
    expect(h.player().position).not.toEqual(atRotation);
    const newBasis = required(
      h.bases.filter((basis) => basis.sessionId.includes(':gesture:')).at(-1),
    );
    expect(newBasis.sessionId).not.toBe(oldBasis.sessionId);
    expect(newBasis.revision).toBeGreaterThan(oldBasis.revision);
    expect(JSON.stringify(oldBasis)).toBe(saved);
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.dispose();
  }
}, 5000);

test('source-free scene join pointer cancellation cannot revive an old held movement', async () => {
  const h = await setupSourceFreeSceneJoin();
  try {
    await h.start();
    h.move(1, 64, true);
    h.game.advance(20);
    const cancelledAt = h.player().position;
    h.pointer(document, 'pointercancel', 1);
    h.move(1, 64);
    h.game.advance(20);
    expect(h.player().position).toEqual(cancelledAt);
    expect(h.player().locomotion).toBe('idle');
    h.move(2, 16, true);
    h.game.advance(20);
    expect(h.player().locomotion).toBe('walk');
    expect(h.player().position).not.toEqual(cancelledAt);
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.dispose();
  }
}, 5000);

// Normal-CI actual-source scene join: exactly one 102-unit correctness gate.
// The dry runs below exercise scheduling, counting and observation without
// loading any pack. This registration does not qualify performance or devices.
import {
  Matrix4 as SceneJoinMatrix,
  type Object3D as SceneJoinNode,
} from 'three';
const SCENE_JOIN_CLOCKS = Object.freeze([
  0, 0, 20, 40, 40, 40, 40, 60, 80, 100,
]);
const SCENE_JOIN_PLAYER_MODES = Object.freeze([
  'idle',
  'idle',
  'walk',
  'run',
  'run',
  'run',
  'run',
  'idle',
  'jump',
  'jump',
]);
// Retained full descriptor pins, not prose animation spans. These are assertions
// on the prepared pack below, never synthetic bindings supplied to the consumer.
// Root values are direct FLOAT first-key reads, not posed/evaluated data, from
// derived GLB SHA-256 78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b.
// Root node 52, first source key 0.02222222276031971 s; do not assume zero.
const SCENE_JOIN_SOURCE_PINS = Object.freeze({
  Idle: {
    firstRootTranslation: [0, 0, 0],
    durationMs: 2022.2222805023193,
    sourceBindingId:
      'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
  },
  Walk: {
    firstRootTranslation: [0, -0.05400000885128975, 0],
    durationMs: 822.2222328186035,
    sourceBindingId:
      'pose-v1:674f2db6041764b2641b28ffa276c012d9bcc062321ad59b0b1b30aa06b651bf',
  },
  Run: {
    firstRootTranslation: [0, -0.08025126904249191, 0],
    durationMs: 555.555522441864,
    sourceBindingId:
      'pose-v1:f0cb94a371bc4c151a9ffee03a568aeb1bb63bb129b236f7e6bdb7ea907fd8cd',
  },
  Jump: {
    firstRootTranslation: [0, -0.03499952703714371, 0],
    durationMs: 1533.3333015441895,
    sourceBindingId:
      'pose-v1:dcefd88889b37353afb6a3db425eaaa8fe3cd62f01d680497d1c2d9fe4afd339',
  },
});
const SCENE_JOIN_BUDGET = Object.freeze({
  hInitialization: 42,
  bUpdates: 40,
  hQueries: 20,
  total: 102,
});

type SceneJoinFrame = import('../../src/contracts').CommittedFrame;
type SceneJoinController = import('../../src/app/createGame').GameController;
function createSceneJoinLedger(names: readonly string[]) {
  const trusted = new Set(names),
    witnessed = new Set<string>();
  if (names.length !== 42 || trusted.size !== 42)
    throw Error('Scene join requires 42 unique H initialization clips');
  let phase: 'preparation' | 'frames' | 'oracle' | 'finished' = 'preparation';
  let bAttempted = 0,
    bCompleted = 0,
    hAttempted = 0,
    hCompleted = 0;
  const read = () => ({
    phase,
    hInitializationReserved: 42,
    hInitializationCompleted: witnessed.size,
    hInitializationClipIds: [...witnessed],
    bAttempted,
    bCompleted,
    hAttempted,
    hCompleted,
    allInReserved: 42 + bAttempted + hAttempted,
    hardCap: 102,
  });
  return {
    read,
    checkpoint(stage: string) {
      if (!stage.startsWith('clip:')) return;
      const name = stage.slice(5);
      if (phase !== 'preparation' || !trusted.has(name) || witnessed.has(name))
        throw Error('Invalid scene join H initialization checkpoint');
      witnessed.add(name);
    },
    beginFrames() {
      if (phase !== 'preparation' || witnessed.size !== 42 || bAttempted !== 0)
        throw Error('Incomplete scene join initialization');
      phase = 'frames';
    },
    beforeB() {
      bAttempted++;
      if (phase !== 'frames' || bAttempted > 40)
        throw Error('Unexpected scene join B sampling or 40-unit cap excess');
    },
    afterB() {
      if (phase !== 'frames' || bCompleted >= bAttempted)
        throw Error('Unreserved scene join B completion');
      bCompleted++;
    },
    beginOracle() {
      if (phase !== 'frames' || bAttempted !== 40 || bCompleted !== 40)
        throw Error('Incomplete scene join B ledger');
      phase = 'oracle';
    },
    beforeH() {
      if (phase !== 'oracle')
        throw Error('Scene join H query outside oracle phase');
      hAttempted++;
      if (hAttempted > 20 || 42 + bAttempted + hAttempted > 102)
        throw Error('Scene join 102-unit cap excess');
    },
    afterH() {
      if (phase !== 'oracle' || hCompleted >= hAttempted)
        throw Error('Unreserved scene join H completion');
      hCompleted++;
    },
    finish() {
      if (phase !== 'oracle' || hAttempted !== 20 || hCompleted !== 20)
        throw Error('Incomplete scene join H ledger');
      phase = 'finished';
    },
  };
}

/** The full UI sequence is identical for dry-run and future actual-source run.
 * observe runs only after the public operation returns from its actual C draw. */
async function executeSceneJoinInputPlan(
  controls: { game: SceneJoinController; root: HTMLElement },
  observe: () => void = () => {},
) {
  const { game, root } = controls;
  const pointer = (
    target: EventTarget,
    type: string,
    id: number,
    delta = 0,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100 + delta,
      clientY: 200,
    });
    Object.defineProperty(event, 'pointerId', { value: id });
    target.dispatchEvent(event);
  };
  const move = (id: number, delta: number, fresh = false) => {
    if (fresh)
      pointer(required(root.querySelector('.nt-swipe')), 'pointerdown', id);
    pointer(root.ownerDocument, 'pointermove', id, delta);
  };
  const click = (label: string) =>
    required(
      [...root.querySelectorAll('button')].find(
        (button) => button.textContent === label,
      ),
    ).click();
  await game.start();
  observe();
  game.dispatch({ type: 'StartRequested', runId: required(game.read()).runId });
  observe();
  move(1, 16, true);
  game.advance(20);
  observe();
  move(1, 64);
  game.advance(20);
  observe();
  click('設定');
  observe();
  game.advance(1000);
  observe();
  click('設定を閉じる');
  observe();
  move(1, 64);
  game.advance(20);
  observe();
  move(2, 16, true);
  click('ジャンプ');
  game.advance(20);
  observe();
  pointer(root.ownerDocument, 'pointerup', 2);
  game.advance(20);
  observe();
}

function assertSceneJoinInputRow(
  frame: SceneJoinFrame,
  row: number,
  positions: Array<import('../../src/contracts').Vector3>,
) {
  const state = required(
    frame.snapshot.actors.find((actor) => actor.color === 'white'),
  );
  const player = required(
    frame.spatial.actors.find((actor) => actor.actorId === state.actorId),
  );
  expect(frame.snapshot.phase).toBe(
    row === 0 ? 'ready' : row === 4 || row === 5 ? 'paused' : 'running',
  );
  expect(frame.snapshot.clocks.gameTimeMs).toBe(SCENE_JOIN_CLOCKS[row]);
  expect(player.locomotion).toBe(SCENE_JOIN_PLAYER_MODES[row]);
  if (player.pose?.kind !== 'living')
    throw Error('Missing scene join player living stamp');
  expect(player.pose.living.mode).toBe(SCENE_JOIN_PLAYER_MODES[row]);
  if (row >= 4 && row <= 7) expect(player.position).toEqual(positions[3]);
  if (row === 2 || row === 3) {
    expect(player.position).not.toEqual(positions[row - 1]);
    expect(player.position.y).toBe(0);
    expect(player.facing.x).not.toBe(0);
  }
  if (row === 8) {
    expect(player.position.y).toBeGreaterThan(0);
    const before = required(positions[7]);
    expect(
      Math.hypot(player.position.x - before.x, player.position.z - before.z),
    ).toBeGreaterThan(0);
  }
  if (row === 9) {
    const airborne = required(positions[8]);
    expect(player.position.x).toBeCloseTo(airborne.x, 10);
    expect(player.position.z).toBeCloseTo(airborne.z, 10);
    expect(player.position.y).toBeGreaterThan(airborne.y);
  }
  positions.push({ ...player.position });
}

function assertSceneJoinMatrix(
  actual: readonly number[],
  expected: readonly number[],
) {
  expect(actual).toHaveLength(16);
  expect(expected).toHaveLength(16);
  actual.forEach((value, index) => {
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - required(expected[index]))).toBeLessThan(1e-10);
  });
}
function sceneJoinCWorld(actor: import('../../src/contracts').SpatialActor) {
  const { position: p, facing: f } = actor;
  // Independent +Z-forward basis equation, not C's atan2/Euler implementation
  // and never a copy of the rendered physical parent's world matrix.
  return new SceneJoinMatrix().set(
    f.z,
    0,
    f.x,
    p.x,
    0,
    1,
    0,
    p.y,
    -f.x,
    0,
    f.z,
    p.z,
    0,
    0,
    0,
    1,
  );
}
function captureSceneJoinActor(
  frame: SceneJoinFrame,
  actorId: import('../../src/contracts').ActorId,
  node: SceneJoinNode,
  attachment: SceneJoinNode,
  adjustment: SceneJoinMatrix,
  originalNodeLocal: readonly number[],
) {
  const actor = required(
    frame.spatial.actors.find((entry) => entry.actorId === actorId),
  );
  const pose = actor.pose;
  if (pose?.kind !== 'living')
    throw Error('Scene join permits canonical living epochs only');
  const presentation = required(node.parent),
    physical = required(presentation.parent);
  expect(physical.name).toBe(`actor-anchor:${actorId}`);
  expect(presentation.name).toBe(`actor-presentation:${actorId}`);
  expect(physical.visible).toBe(true);
  expect(physical.parent?.type).toBe('Scene');
  const cWorld = sceneJoinCWorld(actor);
  assertSceneJoinMatrix(physical.matrixWorld.toArray(), cWorld.toArray());
  assertSceneJoinMatrix(
    presentation.matrix.toArray(),
    new SceneJoinMatrix().toArray(),
  );
  assertSceneJoinMatrix(node.matrix.toArray(), originalNodeLocal);
  const expectedActorWorld = cWorld
    .clone()
    .multiply(new SceneJoinMatrix().fromArray(originalNodeLocal));
  assertSceneJoinMatrix(
    node.matrixWorld.toArray(),
    expectedActorWorld.toArray(),
  );
  const displayedWorld = attachment.matrixWorld.clone().multiply(adjustment);
  const displayedActorLocal = node.matrixWorld
    .clone()
    .invert()
    .multiply(displayedWorld);
  return {
    actorId,
    epoch: pose.living,
    at: frame.snapshot.clocks.gameTimeMs,
    physical: {
      position: physical.position.toArray(),
      quaternion: physical.quaternion.toArray(),
      scale: physical.scale.toArray(),
    },
    cWorld: cWorld.toArray(),
    expectedActorWorld: expectedActorWorld.toArray(),
    displayedActorLocal: displayedActorLocal.toArray(),
    displayedWorld: displayedWorld.toArray(),
  };
}
function verifySceneJoinOracle(
  captured: ReturnType<typeof captureSceneJoinActor>,
  actorLocal: readonly number[],
) {
  assertSceneJoinMatrix(captured.displayedActorLocal, actorLocal);
  const expectedWorld = new SceneJoinMatrix()
    .fromArray(captured.expectedActorWorld)
    .multiply(new SceneJoinMatrix().fromArray(actorLocal));
  assertSceneJoinMatrix(captured.displayedWorld, expectedWorld.toArray());
}

test('source-free scene admission accounts for all 102 planned units and rejects extra work', () => {
  const names = Array.from(
    { length: 42 },
    (_, index) => `synthetic-clip:${index}`,
  );
  const ledger = createSceneJoinLedger(names);
  names.forEach((name) => {
    ledger.checkpoint(`clip:${name}`);
  });
  ledger.beginFrames();
  SCENE_JOIN_CLOCKS.forEach(() => {
    for (let actor = 0; actor < 2; actor++)
      for (let sample = 0; sample < 2; sample++) {
        ledger.beforeB();
        ledger.afterB();
      }
  });
  ledger.beginOracle();
  for (let query = 0; query < 20; query++) {
    ledger.beforeH();
    ledger.afterH();
  }
  ledger.finish();
  expect(ledger.read()).toMatchObject({
    phase: 'finished',
    hInitializationCompleted: 42,
    bAttempted: 40,
    bCompleted: 40,
    hAttempted: 20,
    hCompleted: 20,
    allInReserved: 102,
    hardCap: 102,
  });
  expect(() => ledger.beforeB()).toThrow(/sampling/);
  expect(() => ledger.beforeH()).toThrow(/outside/);
});

test('source-free scene admission fails closed on early missing duplicated or excess sampling', () => {
  const names = Array.from(
    { length: 42 },
    (_, index) => `synthetic-clip:${index}`,
  );
  const fresh = () => createSceneJoinLedger(names);
  expect(() => fresh().beforeB()).toThrow(/sampling/);
  expect(() => fresh().beforeH()).toThrow(/outside/);
  expect(() => fresh().beginFrames()).toThrow(/Incomplete/);
  const duplicate = fresh();
  duplicate.checkpoint(`clip:${required(names[0])}`);
  expect(() => duplicate.checkpoint(`clip:${required(names[0])}`)).toThrow(
    /Invalid/,
  );
  expect(() => fresh().checkpoint('clip:foreign')).toThrow(/Invalid/);
  const ledger = fresh();
  names.forEach((name) => {
    ledger.checkpoint(`clip:${name}`);
  });
  ledger.beginFrames();
  expect(() => ledger.beginOracle()).toThrow(/Incomplete/);
  for (let sample = 0; sample < 40; sample++) {
    ledger.beforeB();
    ledger.afterB();
  }
  const overflow = fresh();
  names.forEach((name) => {
    overflow.checkpoint(`clip:${name}`);
  });
  overflow.beginFrames();
  for (let sample = 0; sample < 40; sample++) {
    overflow.beforeB();
    overflow.afterB();
  }
  expect(() => overflow.beforeB()).toThrow(/40-unit/);
  ledger.beginOracle();
  for (let sample = 0; sample < 20; sample++) {
    ledger.beforeH();
    ledger.afterH();
  }
  expect(() => ledger.beforeH()).toThrow(/102-unit/);
});

test('source-free scene admission observer follows the exact UI plan after actual C draws', async () => {
  const { Quaternion, Vector3 } = await import('three');
  const h = await setupSourceFreeSceneJoin();
  const captures: ReturnType<typeof captureSceneJoinActor>[] = [];
  const clocks: number[] = [];
  const positions: Array<import('../../src/contracts').Vector3> = [];
  try {
    await executeSceneJoinInputPlan(h, () => {
      const frame = required(h.frames.at(-1));
      expect(h.drawn.at(-1)?.frame).toBe(frame);
      assertSceneJoinInputRow(frame, clocks.length, positions);
      clocks.push(frame.snapshot.clocks.gameTimeMs);
      for (const state of frame.snapshot.actors) {
        if (!frame.snapshot.residentActorIds?.includes(state.actorId)) continue;
        const entry = required(h.rigs.get(state.color));
        const captured = captureSceneJoinActor(
          frame,
          state.actorId,
          entry.node,
          entry.tip,
          new SceneJoinMatrix(),
          entry.baseline,
        );
        const mode = ['idle', 'walk', 'run', 'jump'].indexOf(
          captured.epoch.mode,
        );
        const actorLocal = new SceneJoinMatrix()
          .compose(
            new Vector3(0.2 + captured.at / 1000, 0.5 + mode / 10, -0.1),
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), mode / 5),
            new Vector3(1.05, 0.95, 1.1),
          )
          .multiply(new SceneJoinMatrix().makeTranslation(0, 0.3, 0.2));
        verifySceneJoinOracle(captured, actorLocal.toArray());
        captures.push(captured);
      }
    });
    expect(clocks).toEqual(SCENE_JOIN_CLOCKS);
    expect(captures).toHaveLength(20);
    expect(h.requests).toHaveLength(20);
    expect(h.drawn).toHaveLength(11);
    const corruptedWorld = new SceneJoinMatrix().fromArray(
      required(captures[0]).displayedWorld,
    );
    corruptedWorld.elements[12] += 1;
    const corrupted = {
      ...required(captures[0]),
      displayedWorld: corruptedWorld.toArray(),
    };
    expect(() =>
      verifySceneJoinOracle(corrupted, corrupted.displayedActorLocal),
    ).toThrow();
  } finally {
    h.dispose();
  }
}, 5000);

test('admitted actual source scene join uses 102 all-in units across ten noncombat frames', async () => {
  const fs = await import('node:fs'),
    path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { AnimationMixer, SkinnedMesh } = await import('three');
  const { ANDROID_DERIVED_PACK_V1 } = await import(
    '../../src/assets/derivedPackManifest'
  );
  const { preparePinnedSourceHead } = await import(
    '../../src/assets/headSurface'
  );
  const { RECOVERY_FRAME_CAPABILITY } = await import(
    '../../src/assets/poseFramePreparation'
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=no'))
    throw Error('Scene join requires a clean committed working tree');
  const ledger = createSceneJoinLedger(
    ANDROID_DERIVED_PACK_V1.clips.map((clip) => clip.name),
  );
  fs.mkdirSync('reports', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('reports/actual-scene-join-'));
  const records: unknown[] = [],
    captures: ReturnType<typeof captureSceneJoinActor>[] = [];
  const requests: import('../../src/assets/poseFramePreparation').PoseFrameRequest[] =
    [];
  const frameClocks: number[] = [],
    preparationMs: number[] = [];
  const playerPositions: Array<import('../../src/contracts').Vector3> = [];
  let cpuSceneCalls = 0,
    appliedFrames = 0,
    fullRigs = 0,
    peakRigs = 0,
    staged = 0,
    peakStaged = 0,
    mounted = 0;
  let packDisposed = false,
    hDisposed = false,
    packOwned = false,
    hOwned = false;
  let game: SceneJoinController | undefined;
  let numeric: Awaited<ReturnType<typeof preparePinnedSourceHead>> | undefined;
  const root = document.createElement('main');
  document.body.append(root);
  const cleanups: Array<() => void> = [
    () => {
      if (
        fullRigs ||
        staged ||
        mounted ||
        (packOwned && !packDisposed) ||
        (hOwned && !hDisposed)
      )
        throw Error('Outstanding actual scene join resource ownership');
    },
    () => root.remove(),
  ];
  const rigs = new Map<
    ActorColor,
    {
      rig: import('../../src/assets').ActorRig<SceneJoinNode>;
      baseline: number[];
    }
  >();
  let drawing: SceneJoinFrame | undefined;
  await ownIdleRun(
    async () => {
      try {
        records.push({
          marker: 'ADMISSION',
          value: {
            commit,
            tree: git('rev-parse', 'HEAD^{tree}'),
            harnessBlob: git(
              'rev-parse',
              'HEAD:tests/integration/stampedConsumerIntegration.test.ts',
            ),
            node: process.version,
            budget: SCENE_JOIN_BUDGET,
            gameTimesMs: SCENE_JOIN_CLOCKS,
            sourceFree: false,
            sourceExecutionCount: 1,
            warmups: 0,
            cpuRendererOnly: true,
            performanceAccepted: false,
            iPhoneAccepted: false,
            hStaticBindHierarchyUpdates: 1,
          },
        });
        const derivedBytes = new Uint8Array(
          fs.readFileSync('public/game-assets/android/derived-pack-v1.glb'),
        );
        const artifactBytes = new Uint8Array(
          fs.readFileSync(
            'public/game-assets/android/runtime-artifact-v1.json',
          ),
        );
        const derivedSha256 = createHash('sha256')
          .update(derivedBytes)
          .digest('hex');
        expect(derivedSha256).toBe(
          '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
        );
        // Noncombat selected clips retain the existing full pinned setup's root policy:
        // no new extraction policy is introduced by this test. B and H receive exactly
        // the same empty list; actual full descriptors authorize all four locomotions.
        const rootPolicies: readonly import('../../src/assets/rootPolicy').ClipRootPolicy[] =
          Object.freeze([]);
        records.push({
          marker: 'INPUTS',
          value: {
            derivedSha256,
            artifactSha256: createHash('sha256')
              .update(artifactBytes)
              .digest('hex'),
            rootPolicies,
            rawFirstRootPins: SCENE_JOIN_SOURCE_PINS,
            rawFirstRootPinsDerivedSha256:
              '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
          },
        });
        const originalUpdate = AnimationMixer.prototype.update;
        AnimationMixer.prototype.update = function (
          this: InstanceType<typeof AnimationMixer>,
          delta: number,
        ) {
          ledger.beforeB();
          const result = originalUpdate.call(this, delta);
          ledger.afterB();
          return result;
        };
        cleanups.push(() => {
          AnimationMixer.prototype.update = originalUpdate;
        });
        const actualCreateScene = SceneModule.createSceneAdapter;
        const sceneSpy = vi
          .spyOn(SceneModule, 'createSceneAdapter')
          .mockImplementation((...args) => {
            const actual = actualCreateScene(...args);
            return {
              ...actual,
              render(frame) {
                drawing = frame;
                actual.render(frame);
              },
              renderHost: {
                ...actual.renderHost,
                mountActor(request) {
                  const detach = actual.renderHost.mountActor(request);
                  mounted++;
                  let closed = false;
                  return () => {
                    if (closed) return;
                    closed = true;
                    try {
                      detach();
                    } finally {
                      mounted--;
                    }
                  };
                },
              },
            };
          });
        cleanups.push(() => sceneSpy.mockRestore());
        const layout = {
          ...SceneModule.createParisStreetLayout(),
          vehicles: [],
          objects: [],
          actorSpawns: {
            ...SceneModule.createParisStreetLayout().actorSpawns,
            white: { x: 0.7, y: 0, z: -0.8 },
          },
        };
        game = createIntegratedGame(root, {
          sessionId: 'actual-source-scene-join',
          seed: 1,
          stepMs: 20,
          viewport: {
            widthCssPx: 400,
            heightCssPx: 800,
            offsetLeftCssPx: 0,
            offsetTopCssPx: 0,
            devicePixelRatio: 1,
            safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          posePolicy: {
            version: 1,
            mode: 'deterministic-pose-v1',
            recovery: RECOVERY_FRAME_CAPABILITY,
          },
          configuration: {
            moves: syntheticTimingMoves(),
            layout,
            world: { vehicles: [], objects: [] },
            async loadAssets(_context, signal) {
              const started = performance.now();
              const controller = new AbortController();
              const abort = () => controller.abort();
              signal.addEventListener('abort', abort, { once: true });
              const timer = setTimeout(abort, 30_000);
              let pack:
                | Awaited<ReturnType<typeof createPinnedDerivedThreeAssetPack>>
                | undefined;
              try {
                pack = await createPinnedDerivedThreeAssetPack({
                  derivedBytes,
                  artifactBytes,
                  rootPolicies,
                  signal: controller.signal,
                });
                packOwned = true;
                const ownedPack = pack;
                const closePack = () => {
                  if (!packDisposed) {
                    ownedPack.dispose();
                    packDisposed = true;
                  }
                };
                cleanups.push(closePack);
                numeric = await preparePinnedSourceHead({
                  derivedBytes,
                  rootPolicies,
                  signal: controller.signal,
                  checkpoint: async (stage) => ledger.checkpoint(stage),
                });
                hOwned = true;
                const ownedHead = numeric;
                cleanups.push(() => {
                  if (!hDisposed) {
                    ownedHead.dispose();
                    hDisposed = true;
                  }
                });
                const descriptor = required(pack.poseBindings);
                for (const name of ['Idle', 'Walk', 'Run', 'Jump'] as const) {
                  const binding = required(
                    descriptor.clips.find((entry) => entry.clipId === name),
                  );
                  const { durationMs, sourceBindingId } =
                    SCENE_JOIN_SOURCE_PINS[name];
                  expect(binding).toMatchObject({
                    durationMs,
                    sourceBindingId,
                  });
                  expect(pack.rootPolicy(binding.clipId)).toBeUndefined();
                  expect(pack.clipDuration(binding.clipId)).toBe(
                    binding.durationMs,
                  );
                  expect(
                    numeric.poseBindings.clips.find(
                      (entry) => entry.clipId === name,
                    ),
                  ).toEqual(binding);
                }
                expect(descriptor.locomotion).toEqual({
                  idle: 'Idle',
                  walk: 'Walk',
                  run: 'Run',
                  jump: 'Jump',
                });
                expect(pack.recoveryCapability).toEqual(
                  RECOVERY_FRAME_CAPABILITY,
                );
                expect(ledger.read().bAttempted).toBe(0);
                preparationMs.push(performance.now() - started);
                records.push({
                  marker: 'PREPARATION',
                  value: {
                    descriptor,
                    hBindings: numeric.poseBindings,
                    hDescriptor: numeric.descriptor,
                    rootPolicies,
                    elapsedMs: preparationMs[0],
                    ledger: ledger.read(),
                  },
                });
                const wrapDriver = (
                  color: ActorColor,
                  driver: import('../../src/assets/poseFramePreparation').PoseFrameDriver,
                ) => ({
                  capability: driver.capability,
                  prepare(
                    request: import('../../src/assets/poseFramePreparation').PoseFrameRequest,
                  ) {
                    requests.push(request);
                    return driver.prepare(request);
                  },
                  apply(
                    command: import('../../src/assets/poseFramePreparation').PreparedPoseFrame,
                  ) {
                    const { rig, baseline } = required(rigs.get(color));
                    const parents: SceneJoinNode[] = [];
                    for (
                      let parent = rig.node.parent;
                      parent;
                      parent = parent.parent
                    )
                      parents.push(parent);
                    const before = parents.map((parent) => ({
                      position: parent.position.toArray(),
                      rotation: parent.quaternion.toArray(),
                      scale: parent.scale.toArray(),
                    }));
                    driver.apply(command);
                    appliedFrames++;
                    expect(
                      parents.map((parent) => ({
                        position: parent.position.toArray(),
                        rotation: parent.quaternion.toArray(),
                        scale: parent.scale.toArray(),
                      })),
                    ).toEqual(before);
                    assertSceneJoinMatrix(
                      new SceneJoinMatrix()
                        .compose(
                          rig.node.position,
                          rig.node.quaternion,
                          rig.node.scale,
                        )
                        .toArray(),
                      baseline,
                    );
                  },
                  dispose() {
                    driver.dispose();
                  },
                });
                const wrapRig = (
                  color: ActorColor,
                  rig: import('../../src/assets').ActorRig<SceneJoinNode>,
                  transferredDriver?: import('../../src/assets/poseFramePreparation').PoseFrameDriver,
                ) => {
                  let closed = false,
                    counted = false;
                  try {
                    if (rigs.has(color))
                      throw Error('Duplicate actual resident rig');
                    const baseline = new SceneJoinMatrix()
                      .compose(
                        rig.node.position,
                        rig.node.quaternion,
                        rig.node.scale,
                      )
                      .toArray();
                    const poseFrame =
                      transferredDriver ??
                      wrapDriver(color, required(rig.poseFrame));
                    fullRigs++;
                    counted = true;
                    peakRigs = Math.max(peakRigs, fullRigs);
                    if (fullRigs > 2)
                      throw Error(
                        'Actual scene join exceeds two resident rigs',
                      );
                    const wrapped = {
                      ...rig,
                      poseFrame,
                      dispose() {
                        if (closed) return;
                        closed = true;
                        try {
                          try {
                            expect(rig.node.parent).toBeNull();
                          } finally {
                            rig.dispose();
                          }
                        } finally {
                          rigs.delete(color);
                          if (counted) {
                            fullRigs--;
                            counted = false;
                          }
                        }
                      },
                    };
                    rigs.set(color, { rig: wrapped, baseline });
                    return wrapped;
                  } catch (error) {
                    if (counted) {
                      fullRigs--;
                      counted = false;
                    }
                    try {
                      rig.dispose();
                    } catch (cleanupError) {
                      records.push({
                        marker: 'RIG_ACQUISITION_CLEANUP_ERROR',
                        value: String(cleanupError),
                      });
                    }
                    throw error;
                  }
                };
                const timing = createSyntheticTimingCatalog(pack);
                ledger.beginFrames();
                return {
                  motions: timing.motions,
                  animator: {
                    poseBindings: descriptor,
                    recoveryCapability: required(pack.recoveryCapability),
                    locomotionClips: descriptor.locomotion,
                    clipDuration: pack.clipDuration.bind(pack),
                    create(color) {
                      return wrapRig(color, ownedPack.create(color));
                    },
                    stageActor(color) {
                      const handle = required(ownedPack.stageActor).call(
                        ownedPack,
                        color,
                      );
                      staged++;
                      peakStaged = Math.max(peakStaged, staged);
                      let closed = false;
                      // The public animator requires exact staged driver identity
                      // across materialization, not merely equivalent forwarding.
                      const poseFrame = wrapDriver(color, handle.poseFrame);
                      return {
                        poseFrame,
                        materialize() {
                          if (closed)
                            throw Error(
                              'Actual scene stage already transferred',
                            );
                          const rig = handle.materialize();
                          closed = true;
                          staged--;
                          return wrapRig(color, rig, poseFrame);
                        },
                        dispose() {
                          if (!closed) {
                            closed = true;
                            try {
                              handle.dispose();
                            } finally {
                              staged--;
                            }
                          }
                        },
                      };
                    },
                    dispose: closePack,
                  },
                };
              } catch (error) {
                if (pack && !packOwned) pack.dispose();
                throw error;
              } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
              }
            },
          },
          createRenderer: () => ({
            domElement: document.createElement('canvas'),
            setSize() {},
            setPixelRatio() {},
            dispose() {},
            render(scene, camera) {
              cpuSceneCalls++;
              const frame = required(drawing);
              // C has just applied this frame's physical anchors. Emulate the renderer's
              // world update, then read only the already applied B pose; no extra seek.
              scene.updateMatrixWorld(true);
              camera.updateMatrixWorld(true);
              if (frame.snapshot.phase === 'loading') {
                expect(rigs.size).toBe(0);
                return;
              }
              const row = frameClocks.length;
              if (row >= 10) throw Error('Unexpected extra actual scene draw');
              expect(frame.snapshot.clocks.gameTimeMs).toBe(
                SCENE_JOIN_CLOCKS[row],
              );
              assertSceneJoinInputRow(frame, row, playerPositions);
              frameClocks.push(frame.snapshot.clocks.gameTimeMs);
              expect(fullRigs).toBe(2);
              expect(mounted).toBe(2);
              expect(staged).toBe(0);
              expect(requests).toHaveLength((row + 1) * 2);
              expect(appliedFrames).toBe((row + 1) * 2);
              expect(ledger.read()).toMatchObject({
                bAttempted: (row + 1) * 4,
                bCompleted: (row + 1) * 4,
              });
              expect(frame.snapshot.actors.map((actor) => actor.hp)).toEqual([
                500, 500, 500, 500, 700,
              ]);
              const head = required(numeric);
              const adjustment = new SceneJoinMatrix()
                .fromArray(head.descriptor.headAttachmentAtBind)
                .invert()
                .multiply(
                  new SceneJoinMatrix().fromArray(
                    head.descriptor.referenceToActorAtBind,
                  ),
                );
              const rowCaptures: ReturnType<typeof captureSceneJoinActor>[] =
                [];
              const nativeRootTranslations: unknown[] = [];
              for (const id of required(frame.snapshot.residentActorIds)) {
                const state = required(
                  frame.snapshot.actors.find((actor) => actor.actorId === id),
                );
                expect(state.attack).toBeNull();
                expect(state.defeated).toBe(false);
                const entry = required(rigs.get(state.color));
                const meshes: InstanceType<typeof SkinnedMesh>[] = [];
                entry.rig.node.traverse((part) => {
                  if (part instanceof SkinnedMesh) meshes.push(part);
                });
                const mesh = required(meshes[head.descriptor.meshIndex]);
                const attachment = required(
                  mesh.skeleton.bones[head.descriptor.headJointIndex],
                );
                const captured = captureSceneJoinActor(
                  frame,
                  id,
                  entry.rig.node,
                  attachment,
                  adjustment,
                  entry.baseline,
                );
                const sourcePin = required(
                  Object.entries(SCENE_JOIN_SOURCE_PINS).find(
                    ([name]) => name === captured.epoch.binding.clipId,
                  )?.[1],
                );
                const rootTranslation = required(
                  entry.rig.node.getObjectByName('root'),
                ).position.toArray();
                // Independent raw source first key, not B/H agreement alone.
                // Legacy FULL extraction preserves this native local baseline
                // while C alone supplies the physical XZ and jump Y transport.
                expect(rootTranslation).toEqual(sourcePin.firstRootTranslation);
                nativeRootTranslations.push({
                  actorId: id,
                  binding: captured.epoch.binding,
                  actual: rootTranslation,
                  expected: sourcePin.firstRootTranslation,
                });
                expect(
                  requests
                    .slice(row * 2, row * 2 + 2)
                    .find((request) => request.actorId === id),
                ).toMatchObject({
                  kind: 'living',
                  epoch: captured.epoch,
                  at: captured.at,
                  side: 'right',
                });
                captures.push(captured);
                rowCaptures.push(captured);
              }
              records.push({
                marker: 'AFTER_ACTUAL_C_CPU_DRAW',
                value: {
                  row: row + 1,
                  snapshot: frame.snapshot,
                  spatial: frame.spatial,
                  captures: rowCaptures,
                  nativeRootTranslations,
                  ledger: ledger.read(),
                },
              });
            },
          }),
        });
        const ownedGame = game;
        await executeSceneJoinInputPlan({ game: ownedGame, root });
        expect(frameClocks).toEqual(SCENE_JOIN_CLOCKS);
        expect(cpuSceneCalls).toBe(11);
        expect(captures).toHaveLength(20);
        expect(requests).toHaveLength(20);
        expect(appliedFrames).toBe(20);
        records.push({ marker: 'ALL_B_PREPARE_REQUESTS', value: requests });
        ledger.beginOracle();
        for (const captured of captures) {
          ledger.beforeH();
          const sample = required(numeric).epochDiagnostic.point(
            captured.epoch,
            captured.at,
            'right',
          );
          ledger.afterH();
          if (sample.kind !== 'transform')
            throw Error(`Unsupported scene join H query: ${sample.reason}`);
          verifySceneJoinOracle(captured, sample.matrix);
          records.push({
            marker: 'INDEPENDENT_H_WORLD',
            value: {
              actorId: captured.actorId,
              at: captured.at,
              epoch: captured.epoch,
              sample,
              displayedWorld: captured.displayedWorld,
              independentCWorld: captured.cWorld,
            },
          });
        }
        ledger.finish();
        expect(peakRigs).toBe(2);
        expect(ownedGame.lastError()).toBeNull();
        records.push({
          marker: 'PASS',
          value: {
            ledger: ledger.read(),
            cpuSceneCalls,
            bFrames: frameClocks.length,
            actorPreparations: requests.length,
            actorApplications: appliedFrames,
            hQueries: captures.length,
            peakRigs,
            peakStaged,
            sourceBindings: 'prepared-pinned-pack-and-H-equality',
            residentScope: 'materialized-public-actor-rigs-only',
            sourceRootPolicy: 'legacy-full-translation-no-explicit-policy',
            footLockingAccepted: false,
            sourceBobVisualAccepted: false,
            nativeJumpTimingAccepted: false,
            actualWebGL: false,
            sourceLandingAccepted: false,
            compositeRecoveryAccepted: false,
            performanceAccepted: false,
          },
        });
      } finally {
        // Appended after asynchronous acquisition: reverse traversal detaches
        // and disposes the game before the H/pack safety nets and spy restores.
        cleanups.push(() => game?.dispose());
      }
    },
    cleanups,
    (terminal) => {
      records.push({
        marker: 'TERMINAL',
        value: {
          ...terminal,
          ledger: ledger.read(),
          cpuSceneCalls,
          bFrames: frameClocks.length,
          actorPreparations: requests.length,
          actorApplications: appliedFrames,
          capturedActors: captures.length,
          hQueries: ledger.read().hAttempted,
          fullRigs,
          peakRigs,
          staged,
          peakStaged,
          mounted,
          packOwned,
          hOwned,
          packDisposed,
          hDisposed,
        },
      });
      fs.writeFileSync(
        path.join(directory, 'scene-join-receipt.json'),
        `${JSON.stringify(records, null, 2)}\n`,
        { flag: 'wx' },
      );
    },
  );
}, 60_000);

// Separate diagnostic progression schedule. Changing hold durations is explicit:
// 60 ms Walk, 60 ms Run, 1120 ms released Jump tail. No gameplay policy changes.
// Every fixed C step publishes B: 69 B frames, not ten. Only ten frames will
// receive independent H queries in the separately admitted 338-unit source run.
const SCENE_PROGRESSION_CLOCKS = Object.freeze([
  0,
  0,
  20,
  40,
  60,
  80,
  100,
  120,
  120,
  120,
  120,
  140,
  ...Array.from({ length: 57 }, (_, index) => 160 + index * 20),
]);
const SCENE_PROGRESSION_H_FRAMES = Object.freeze([
  1, 5, 8, 9, 10, 11, 12, 15, 40, 69,
]);
const SCENE_PROGRESSION_BUDGET = Object.freeze({
  hInitialization: 42,
  bUpdates: 276,
  hQueries: 20,
  total: 338,
});

function createSceneProgressionLedger(names: readonly string[]) {
  const trusted = new Set(names),
    witnessed = new Set<string>();
  if (names.length !== 42 || trusted.size !== 42)
    throw Error('Scene join requires 42 unique H initialization clips');
  let phase: 'preparation' | 'frames' | 'oracle' | 'finished' = 'preparation';
  let bAttempted = 0,
    bCompleted = 0,
    hAttempted = 0,
    hCompleted = 0;
  const read = () => ({
    phase,
    hInitializationReserved: 42,
    hInitializationCompleted: witnessed.size,
    hInitializationClipIds: [...witnessed],
    bAttempted,
    bCompleted,
    hAttempted,
    hCompleted,
    allInReserved: 42 + bAttempted + hAttempted,
    hardCap: 338,
  });
  return {
    read,
    checkpoint(stage: string) {
      if (!stage.startsWith('clip:')) return;
      const name = stage.slice(5);
      if (phase !== 'preparation' || !trusted.has(name) || witnessed.has(name))
        throw Error('Invalid scene progression H initialization checkpoint');
      witnessed.add(name);
    },
    beginFrames() {
      if (phase !== 'preparation' || witnessed.size !== 42 || bAttempted !== 0)
        throw Error('Incomplete scene progression initialization');
      phase = 'frames';
    },
    beforeB() {
      bAttempted++;
      if (phase !== 'frames' || bAttempted > 276)
        throw Error(
          'Unexpected scene progression B sampling or 276-unit cap excess',
        );
    },
    afterB() {
      if (phase !== 'frames' || bCompleted >= bAttempted)
        throw Error('Unreserved scene progression B completion');
      bCompleted++;
    },
    beginOracle() {
      if (phase !== 'frames' || bAttempted !== 276 || bCompleted !== 276)
        throw Error('Incomplete scene progression B ledger');
      phase = 'oracle';
    },
    beforeH() {
      if (phase !== 'oracle')
        throw Error('Scene join H query outside oracle phase');
      hAttempted++;
      if (hAttempted > 20 || 42 + bAttempted + hAttempted > 338)
        throw Error('Scene join 338-unit cap excess');
    },
    afterH() {
      if (phase !== 'oracle' || hCompleted >= hAttempted)
        throw Error('Unreserved scene progression H completion');
      hCompleted++;
    },
    finish() {
      if (phase !== 'oracle' || hAttempted !== 20 || hCompleted !== 20)
        throw Error('Incomplete scene progression H ledger');
      phase = 'finished';
    },
  };
}

async function executeSceneProgressionInputPlan(
  controls: { game: SceneJoinController; root: HTMLElement },
  observe: () => void = () => {},
) {
  const { game, root } = controls;
  const pointer = (
    target: EventTarget,
    type: string,
    id: number,
    delta = 0,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 100 + delta,
      clientY: 200,
    });
    Object.defineProperty(event, 'pointerId', { value: id });
    target.dispatchEvent(event);
  };
  const move = (id: number, delta: number, fresh = false) => {
    if (fresh)
      pointer(required(root.querySelector('.nt-swipe')), 'pointerdown', id);
    pointer(root.ownerDocument, 'pointermove', id, delta);
  };
  const click = (label: string) =>
    required(
      [...root.querySelectorAll('button')].find(
        (button) => button.textContent === label,
      ),
    ).click();
  await game.start();
  observe();
  game.dispatch({ type: 'StartRequested', runId: required(game.read()).runId });
  observe();
  move(1, 16, true);
  game.advance(60);
  observe();
  move(1, 64);
  game.advance(60);
  observe();
  click('設定');
  observe();
  game.advance(1000);
  observe();
  click('設定を閉じる');
  observe();
  move(1, 64);
  game.advance(20);
  observe();
  move(2, 16, true);
  click('ジャンプ');
  game.advance(20);
  observe();
  pointer(root.ownerDocument, 'pointerup', 2);
  game.advance(1120);
  observe();
}

function assertSceneProgressionRow(
  frame: SceneJoinFrame,
  row: number,
  positions: Array<import('../../src/contracts').Vector3>,
) {
  if (row < 0 || row >= 69) throw Error('Unexpected extra progression frame');
  expect(positions).toHaveLength(row);
  expect(frame.snapshot.clocks.gameTimeMs).toBe(SCENE_PROGRESSION_CLOCKS[row]);
  expect(frame.snapshot.phase).toBe(
    row === 0 ? 'ready' : row === 8 || row === 9 ? 'paused' : 'running',
  );
  expect(frame.snapshot.actors.map((actor) => actor.hp)).toEqual([
    500, 500, 500, 500, 700,
  ]);
  expect(
    frame.snapshot.actors.every(
      (actor) => actor.attack === null && !actor.defeated,
    ),
  ).toBe(true);
  const residents = required(frame.snapshot.residentActorIds);
  expect(residents).toHaveLength(2);
  expect(
    residents
      .map(
        (id) =>
          required(frame.snapshot.actors.find((actor) => actor.actorId === id))
            .color,
      )
      .sort(),
  ).toEqual(['blue', 'white']);
  for (const id of residents) {
    const spatial = required(
      frame.spatial.actors.find((actor) => actor.actorId === id),
    );
    if (spatial.pose?.kind !== 'living')
      throw Error('Progression disallows attacks, recovery and defeat');
    expect(['idle', 'walk', 'run', 'jump']).toContain(spatial.pose.living.mode);
    expect(
      [
        spatial.position.x,
        spatial.position.y,
        spatial.position.z,
        spatial.facing.x,
        spatial.facing.z,
      ].every(Number.isFinite),
    ).toBe(true);
  }
  const state = required(
    frame.snapshot.actors.find((actor) => actor.color === 'white'),
  );
  const player = required(
    frame.spatial.actors.find((actor) => actor.actorId === state.actorId),
  );
  const expectedMode =
    row < 2
      ? 'idle'
      : row <= 4
        ? 'walk'
        : row <= 10
          ? 'run'
          : row === 11 || row === 68
            ? 'idle'
            : 'jump';
  const expectedStart =
    row < 2
      ? 0
      : row <= 4
        ? 20
        : row <= 10
          ? 80
          : row === 11
            ? 140
            : row === 68
              ? 1280
              : 160;
  expect(player.locomotion).toBe(expectedMode);
  expect(player.pose).toMatchObject({
    kind: 'living',
    living: { mode: expectedMode, startedAt: expectedStart },
  });
  if (row >= 8 && row <= 11) expect(player.position).toEqual(positions[7]);
  if (row >= 2 && row <= 7) {
    expect(player.position).not.toEqual(positions[row - 1]);
    expect(player.position.y).toBe(0);
  }
  if (row === 12) {
    const before = required(positions[11]);
    expect(
      Math.hypot(player.position.x - before.x, player.position.z - before.z),
    ).toBeGreaterThan(0);
  }
  if (row >= 13) {
    const released = required(positions[12]);
    expect(player.position.x).toBeCloseTo(released.x, 10);
    expect(player.position.z).toBeCloseTo(released.z, 10);
  }
  if (row >= 12) {
    // Independent C motor equation for this obstacle-free fixture, not a source
    // Jump pose oracle. C jump starts in [140,160]; its stamp begins at160.
    const t = (frame.snapshot.clocks.gameTimeMs - 140) / 1000;
    expect(player.position.y).toBeCloseTo(
      Math.max(0, 5.5 * t - 4.905 * t * t),
      9,
    );
    expect(player.grounded).toBe(row === 68);
  }
  positions.push({ ...player.position });
}

test('source-free scene progression freezes all 69 frames and the exact 338-unit ledger', () => {
  expect(SCENE_PROGRESSION_CLOCKS).toHaveLength(69);
  expect(SCENE_PROGRESSION_H_FRAMES).toEqual([
    1, 5, 8, 9, 10, 11, 12, 15, 40, 69,
  ]);
  expect(
    SCENE_PROGRESSION_H_FRAMES.map(
      (frame) => SCENE_PROGRESSION_CLOCKS[frame - 1],
    ),
  ).toEqual([0, 60, 120, 120, 120, 120, 140, 200, 700, 1280]);
  const names = Array.from(
    { length: 42 },
    (_, index) => `SYNTHETIC-PROGRESSION:${index}`,
  );
  const fresh = () => createSceneProgressionLedger(names);
  expect(() => fresh().beforeB()).toThrow(/sampling/);
  expect(() => fresh().beforeH()).toThrow(/outside/);
  expect(() => fresh().beginFrames()).toThrow(/Incomplete/);
  const duplicate = fresh();
  duplicate.checkpoint(`clip:${required(names[0])}`);
  expect(() => duplicate.checkpoint(`clip:${required(names[0])}`)).toThrow(
    /Invalid/,
  );
  const ledger = fresh();
  names.forEach((name) => {
    ledger.checkpoint(`clip:${name}`);
  });
  ledger.beginFrames();
  for (const _clock of SCENE_PROGRESSION_CLOCKS) {
    for (let actor = 0; actor < 2; actor++) {
      for (let sample = 0; sample < 2; sample++) {
        ledger.beforeB();
        ledger.afterB();
      }
    }
  }
  ledger.beginOracle();
  for (let query = 0; query < 20; query++) {
    ledger.beforeH();
    ledger.afterH();
  }
  ledger.finish();
  expect(ledger.read()).toMatchObject({
    phase: 'finished',
    hInitializationCompleted: 42,
    bAttempted: 276,
    bCompleted: 276,
    hAttempted: 20,
    hCompleted: 20,
    allInReserved: 338,
    hardCap: 338,
  });
  expect(() => ledger.beforeB()).toThrow(/276-unit/);
  expect(() => ledger.beforeH()).toThrow(/outside/);
  expect(SCENE_PROGRESSION_BUDGET).toEqual({
    hInitialization: 42,
    bUpdates: 276,
    hQueries: 20,
    total: 338,
  });
});

test('source-free scene progression preserves C roots input cancellation HP and the physical landing across all 69 frames', async () => {
  const { Quaternion, Vector3 } = await import('three');
  const h = await setupSourceFreeSceneJoin();
  try {
    await executeSceneProgressionInputPlan(h);
    expect(h.drawn).toHaveLength(70);
    const draws = h.drawn.filter(
      (draw) => draw.frame.snapshot.phase !== 'loading',
    );
    expect(draws).toHaveLength(69);
    expect(h.requests).toHaveLength(138);
    expect(h.events.filter((event) => event.startsWith('apply:'))).toHaveLength(
      138,
    );
    const positions: Array<import('../../src/contracts').Vector3> = [];
    const selected: Array<{
      row: number;
      time: number;
      mode: string;
      sourceElapsed: number;
    }> = [];
    for (const [row, draw] of draws.entries()) {
      const frame = draw.frame;
      assertSceneProgressionRow(frame, row, positions);
      expect(frame.snapshot.residentActorIds).toEqual(
        draws[0]?.frame.snapshot.residentActorIds,
      );
      expect(draw.actors).toHaveLength(2);
      for (const shown of draw.actors) {
        const state = required(
          frame.snapshot.actors.find((actor) => actor.color === shown.color),
        );
        const actor = required(
          frame.spatial.actors.find((entry) => entry.actorId === state.actorId),
        );
        if (actor.pose?.kind !== 'living')
          throw Error('Missing synthetic progression epoch');
        const mode = ['idle', 'walk', 'run', 'jump'].indexOf(
          actor.pose.living.mode,
        );
        const entry = required(h.rigs.get(shown.color));
        const expected = sceneJoinCWorld(actor)
          .multiply(new SceneJoinMatrix().fromArray(entry.baseline))
          .multiply(
            new SceneJoinMatrix().compose(
              new Vector3(
                0.2 + frame.snapshot.clocks.gameTimeMs / 1000,
                0.5 + mode / 10,
                -0.1,
              ),
              new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), mode / 5),
              new Vector3(1.05, 0.95, 1.1),
            ),
          )
          .multiply(new SceneJoinMatrix().makeTranslation(0, 0.3, 0.2));
        assertSceneJoinMatrix(shown.world, expected.toArray());
        expect(
          h.requests
            .slice(row * 2, row * 2 + 2)
            .find((request) => request.color === shown.color)?.request,
        ).toMatchObject({
          kind: 'living',
          epoch: actor.pose.living,
          at: frame.snapshot.clocks.gameTimeMs,
          side: 'right',
        });
        if (
          shown.color === 'white' &&
          SCENE_PROGRESSION_H_FRAMES.includes(row + 1)
        ) {
          selected.push({
            row: row + 1,
            time: frame.snapshot.clocks.gameTimeMs,
            mode: actor.pose.living.mode,
            sourceElapsed:
              frame.snapshot.clocks.gameTimeMs - actor.pose.living.startedAt,
          });
        }
      }
    }
    expect(selected).toEqual([
      { row: 1, time: 0, mode: 'idle', sourceElapsed: 0 },
      { row: 5, time: 60, mode: 'walk', sourceElapsed: 40 },
      { row: 8, time: 120, mode: 'run', sourceElapsed: 40 },
      { row: 9, time: 120, mode: 'run', sourceElapsed: 40 },
      { row: 10, time: 120, mode: 'run', sourceElapsed: 40 },
      { row: 11, time: 120, mode: 'run', sourceElapsed: 40 },
      { row: 12, time: 140, mode: 'idle', sourceElapsed: 0 },
      { row: 15, time: 200, mode: 'jump', sourceElapsed: 40 },
      { row: 40, time: 700, mode: 'jump', sourceElapsed: 540 },
      { row: 69, time: 1280, mode: 'idle', sourceElapsed: 0 },
    ]);
    expect(h.game.lastError()).toBeNull();
  } finally {
    h.dispose();
  }
}, 5000);

// Normal-CI registration of the independently reviewed 338-unit progression gate.
// Preserve the completed onset gate above unchanged. Sixty-nine B frames are all
// counted, including unselected H observation rows; this is not a device gate.
test('admitted actual source scene progression uses 338 units across 69 frames and ten H observations', async () => {
  const fs = await import('node:fs'),
    path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { AnimationMixer, SkinnedMesh } = await import('three');
  const { ANDROID_DERIVED_PACK_V1 } = await import(
    '../../src/assets/derivedPackManifest'
  );
  const { preparePinnedSourceHead } = await import(
    '../../src/assets/headSurface'
  );
  const { RECOVERY_FRAME_CAPABILITY } = await import(
    '../../src/assets/poseFramePreparation'
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=no'))
    throw Error('Scene progression requires a clean committed working tree');
  const ledger = createSceneProgressionLedger(
    ANDROID_DERIVED_PACK_V1.clips.map((clip) => clip.name),
  );
  fs.mkdirSync('reports', { recursive: true });
  const directory = fs.mkdtempSync(
    path.resolve('reports/actual-scene-progression-'),
  );
  const records: unknown[] = [],
    captures: Array<
      ReturnType<typeof captureSceneJoinActor> & { bFrame: number }
    > = [];
  const requests: import('../../src/assets/poseFramePreparation').PoseFrameRequest[] =
    [];
  const frameClocks: number[] = [],
    preparationMs: number[] = [];
  const playerPositions: Array<import('../../src/contracts').Vector3> = [];
  let cpuSceneCalls = 0,
    appliedFrames = 0,
    fullRigs = 0,
    peakRigs = 0,
    staged = 0,
    peakStaged = 0,
    mounted = 0;
  let packDisposed = false,
    hDisposed = false,
    packOwned = false,
    hOwned = false;
  let game: SceneJoinController | undefined;
  let numeric: Awaited<ReturnType<typeof preparePinnedSourceHead>> | undefined;
  const root = document.createElement('main');
  document.body.append(root);
  const cleanups: Array<() => void> = [
    () => {
      if (
        fullRigs ||
        staged ||
        mounted ||
        (packOwned && !packDisposed) ||
        (hOwned && !hDisposed)
      )
        throw Error('Outstanding actual scene progression resource ownership');
    },
    () => root.remove(),
  ];
  const rigs = new Map<
    ActorColor,
    {
      rig: import('../../src/assets').ActorRig<SceneJoinNode>;
      baseline: number[];
    }
  >();
  let drawing: SceneJoinFrame | undefined;
  await ownIdleRun(
    async () => {
      try {
        records.push({
          marker: 'ADMISSION',
          value: {
            commit,
            tree: git('rev-parse', 'HEAD^{tree}'),
            harnessBlob: git(
              'rev-parse',
              'HEAD:tests/integration/stampedConsumerIntegration.test.ts',
            ),
            node: process.version,
            budget: SCENE_PROGRESSION_BUDGET,
            gameTimesMs: SCENE_PROGRESSION_CLOCKS,
            hObservationFrames: SCENE_PROGRESSION_H_FRAMES,
            diagnosticHoldDurationsMs: [60, 60, 1120],
            physicalStepMs: 20,
            sourceFree: false,
            sourceExecutionCount: 1,
            warmups: 0,
            cpuRendererOnly: true,
            performanceAccepted: false,
            iPhoneAccepted: false,
            hStaticBindHierarchyUpdates: 1,
          },
        });
        const derivedBytes = new Uint8Array(
          fs.readFileSync('public/game-assets/android/derived-pack-v1.glb'),
        );
        const artifactBytes = new Uint8Array(
          fs.readFileSync(
            'public/game-assets/android/runtime-artifact-v1.json',
          ),
        );
        const derivedSha256 = createHash('sha256')
          .update(derivedBytes)
          .digest('hex');
        expect(derivedSha256).toBe(
          '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
        );
        // Noncombat selected clips retain the existing full pinned setup's root policy:
        // no new extraction policy is introduced by this test. B and H receive exactly
        // the same empty list; actual full descriptors authorize all four locomotions.
        const rootPolicies: readonly import('../../src/assets/rootPolicy').ClipRootPolicy[] =
          Object.freeze([]);
        records.push({
          marker: 'INPUTS',
          value: {
            derivedSha256,
            artifactSha256: createHash('sha256')
              .update(artifactBytes)
              .digest('hex'),
            rootPolicies,
            rawFirstRootPins: SCENE_JOIN_SOURCE_PINS,
            rawFirstRootPinsDerivedSha256:
              '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
          },
        });
        const originalUpdate = AnimationMixer.prototype.update;
        AnimationMixer.prototype.update = function (
          this: InstanceType<typeof AnimationMixer>,
          delta: number,
        ) {
          ledger.beforeB();
          const result = originalUpdate.call(this, delta);
          ledger.afterB();
          return result;
        };
        cleanups.push(() => {
          AnimationMixer.prototype.update = originalUpdate;
        });
        const actualCreateScene = SceneModule.createSceneAdapter;
        const sceneSpy = vi
          .spyOn(SceneModule, 'createSceneAdapter')
          .mockImplementation((...args) => {
            const actual = actualCreateScene(...args);
            return {
              ...actual,
              render(frame) {
                drawing = frame;
                actual.render(frame);
              },
              renderHost: {
                ...actual.renderHost,
                mountActor(request) {
                  const detach = actual.renderHost.mountActor(request);
                  mounted++;
                  let closed = false;
                  return () => {
                    if (closed) return;
                    closed = true;
                    try {
                      detach();
                    } finally {
                      mounted--;
                    }
                  };
                },
              },
            };
          });
        cleanups.push(() => sceneSpy.mockRestore());
        const layout = {
          ...SceneModule.createParisStreetLayout(),
          vehicles: [],
          objects: [],
          actorSpawns: {
            ...SceneModule.createParisStreetLayout().actorSpawns,
            white: { x: 0.7, y: 0, z: -0.8 },
          },
        };
        game = createIntegratedGame(root, {
          sessionId: 'actual-source-scene-progression',
          seed: 1,
          stepMs: 20,
          viewport: {
            widthCssPx: 400,
            heightCssPx: 800,
            offsetLeftCssPx: 0,
            offsetTopCssPx: 0,
            devicePixelRatio: 1,
            safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          posePolicy: {
            version: 1,
            mode: 'deterministic-pose-v1',
            recovery: RECOVERY_FRAME_CAPABILITY,
          },
          configuration: {
            moves: syntheticTimingMoves(),
            layout,
            world: { vehicles: [], objects: [] },
            async loadAssets(_context, signal) {
              const started = performance.now();
              const controller = new AbortController();
              const abort = () => controller.abort();
              signal.addEventListener('abort', abort, { once: true });
              const timer = setTimeout(abort, 30_000);
              let pack:
                | Awaited<ReturnType<typeof createPinnedDerivedThreeAssetPack>>
                | undefined;
              try {
                pack = await createPinnedDerivedThreeAssetPack({
                  derivedBytes,
                  artifactBytes,
                  rootPolicies,
                  signal: controller.signal,
                });
                packOwned = true;
                const ownedPack = pack;
                const closePack = () => {
                  if (!packDisposed) {
                    ownedPack.dispose();
                    packDisposed = true;
                  }
                };
                cleanups.push(closePack);
                numeric = await preparePinnedSourceHead({
                  derivedBytes,
                  rootPolicies,
                  signal: controller.signal,
                  checkpoint: async (stage) => ledger.checkpoint(stage),
                });
                hOwned = true;
                const ownedHead = numeric;
                cleanups.push(() => {
                  if (!hDisposed) {
                    ownedHead.dispose();
                    hDisposed = true;
                  }
                });
                const descriptor = required(pack.poseBindings);
                for (const name of ['Idle', 'Walk', 'Run', 'Jump'] as const) {
                  const binding = required(
                    descriptor.clips.find((entry) => entry.clipId === name),
                  );
                  const { durationMs, sourceBindingId } =
                    SCENE_JOIN_SOURCE_PINS[name];
                  expect(binding).toMatchObject({
                    durationMs,
                    sourceBindingId,
                  });
                  expect(pack.rootPolicy(binding.clipId)).toBeUndefined();
                  expect(pack.clipDuration(binding.clipId)).toBe(
                    binding.durationMs,
                  );
                  expect(
                    numeric.poseBindings.clips.find(
                      (entry) => entry.clipId === name,
                    ),
                  ).toEqual(binding);
                }
                expect(descriptor.locomotion).toEqual({
                  idle: 'Idle',
                  walk: 'Walk',
                  run: 'Run',
                  jump: 'Jump',
                });
                expect(pack.recoveryCapability).toEqual(
                  RECOVERY_FRAME_CAPABILITY,
                );
                expect(ledger.read().bAttempted).toBe(0);
                preparationMs.push(performance.now() - started);
                records.push({
                  marker: 'PREPARATION',
                  value: {
                    descriptor,
                    hBindings: numeric.poseBindings,
                    hDescriptor: numeric.descriptor,
                    rootPolicies,
                    elapsedMs: preparationMs[0],
                    ledger: ledger.read(),
                  },
                });
                const wrapDriver = (
                  color: ActorColor,
                  driver: import('../../src/assets/poseFramePreparation').PoseFrameDriver,
                ) => ({
                  capability: driver.capability,
                  prepare(
                    request: import('../../src/assets/poseFramePreparation').PoseFrameRequest,
                  ) {
                    requests.push(request);
                    return driver.prepare(request);
                  },
                  apply(
                    command: import('../../src/assets/poseFramePreparation').PreparedPoseFrame,
                  ) {
                    const { rig, baseline } = required(rigs.get(color));
                    const parents: SceneJoinNode[] = [];
                    for (
                      let parent = rig.node.parent;
                      parent;
                      parent = parent.parent
                    )
                      parents.push(parent);
                    const before = parents.map((parent) => ({
                      position: parent.position.toArray(),
                      rotation: parent.quaternion.toArray(),
                      scale: parent.scale.toArray(),
                    }));
                    driver.apply(command);
                    appliedFrames++;
                    expect(
                      parents.map((parent) => ({
                        position: parent.position.toArray(),
                        rotation: parent.quaternion.toArray(),
                        scale: parent.scale.toArray(),
                      })),
                    ).toEqual(before);
                    assertSceneJoinMatrix(
                      new SceneJoinMatrix()
                        .compose(
                          rig.node.position,
                          rig.node.quaternion,
                          rig.node.scale,
                        )
                        .toArray(),
                      baseline,
                    );
                  },
                  dispose() {
                    driver.dispose();
                  },
                });
                const wrapRig = (
                  color: ActorColor,
                  rig: import('../../src/assets').ActorRig<SceneJoinNode>,
                  transferredDriver?: import('../../src/assets/poseFramePreparation').PoseFrameDriver,
                ) => {
                  let closed = false,
                    counted = false;
                  try {
                    if (rigs.has(color))
                      throw Error('Duplicate actual resident rig');
                    const baseline = new SceneJoinMatrix()
                      .compose(
                        rig.node.position,
                        rig.node.quaternion,
                        rig.node.scale,
                      )
                      .toArray();
                    const poseFrame =
                      transferredDriver ??
                      wrapDriver(color, required(rig.poseFrame));
                    fullRigs++;
                    counted = true;
                    peakRigs = Math.max(peakRigs, fullRigs);
                    if (fullRigs > 2)
                      throw Error(
                        'Actual scene progression exceeds two resident rigs',
                      );
                    const wrapped = {
                      ...rig,
                      poseFrame,
                      dispose() {
                        if (closed) return;
                        closed = true;
                        try {
                          try {
                            expect(rig.node.parent).toBeNull();
                          } finally {
                            rig.dispose();
                          }
                        } finally {
                          rigs.delete(color);
                          if (counted) {
                            fullRigs--;
                            counted = false;
                          }
                        }
                      },
                    };
                    rigs.set(color, { rig: wrapped, baseline });
                    return wrapped;
                  } catch (error) {
                    if (counted) {
                      fullRigs--;
                      counted = false;
                    }
                    try {
                      rig.dispose();
                    } catch (cleanupError) {
                      records.push({
                        marker: 'RIG_ACQUISITION_CLEANUP_ERROR',
                        value: String(cleanupError),
                      });
                    }
                    throw error;
                  }
                };
                const timing = createSyntheticTimingCatalog(pack);
                ledger.beginFrames();
                return {
                  motions: timing.motions,
                  animator: {
                    poseBindings: descriptor,
                    recoveryCapability: required(pack.recoveryCapability),
                    locomotionClips: descriptor.locomotion,
                    clipDuration: pack.clipDuration.bind(pack),
                    create(color) {
                      return wrapRig(color, ownedPack.create(color));
                    },
                    stageActor(color) {
                      const handle = required(ownedPack.stageActor).call(
                        ownedPack,
                        color,
                      );
                      staged++;
                      peakStaged = Math.max(peakStaged, staged);
                      let closed = false;
                      // The public animator requires exact staged driver identity
                      // across materialization, not merely equivalent forwarding.
                      const poseFrame = wrapDriver(color, handle.poseFrame);
                      return {
                        poseFrame,
                        materialize() {
                          if (closed)
                            throw Error(
                              'Actual scene stage already transferred',
                            );
                          const rig = handle.materialize();
                          closed = true;
                          staged--;
                          return wrapRig(color, rig, poseFrame);
                        },
                        dispose() {
                          if (!closed) {
                            closed = true;
                            try {
                              handle.dispose();
                            } finally {
                              staged--;
                            }
                          }
                        },
                      };
                    },
                    dispose: closePack,
                  },
                };
              } catch (error) {
                if (pack && !packOwned) pack.dispose();
                throw error;
              } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
              }
            },
          },
          createRenderer: () => ({
            domElement: document.createElement('canvas'),
            setSize() {},
            setPixelRatio() {},
            dispose() {},
            render(scene, camera) {
              cpuSceneCalls++;
              const frame = required(drawing);
              // C has just applied this frame's physical anchors. Emulate the renderer's
              // world update, then read only the already applied B pose; no extra seek.
              scene.updateMatrixWorld(true);
              camera.updateMatrixWorld(true);
              if (frame.snapshot.phase === 'loading') {
                expect(rigs.size).toBe(0);
                return;
              }
              const row = frameClocks.length;
              if (row >= 69)
                throw Error('Unexpected extra actual progression draw');
              expect(frame.snapshot.clocks.gameTimeMs).toBe(
                SCENE_PROGRESSION_CLOCKS[row],
              );
              assertSceneProgressionRow(frame, row, playerPositions);
              frameClocks.push(frame.snapshot.clocks.gameTimeMs);
              expect(fullRigs).toBe(2);
              expect(mounted).toBe(2);
              expect(staged).toBe(0);
              expect(requests).toHaveLength((row + 1) * 2);
              expect(appliedFrames).toBe((row + 1) * 2);
              expect(ledger.read()).toMatchObject({
                bAttempted: (row + 1) * 4,
                bCompleted: (row + 1) * 4,
              });
              expect(frame.snapshot.actors.map((actor) => actor.hp)).toEqual([
                500, 500, 500, 500, 700,
              ]);
              const head = required(numeric);
              const adjustment = new SceneJoinMatrix()
                .fromArray(head.descriptor.headAttachmentAtBind)
                .invert()
                .multiply(
                  new SceneJoinMatrix().fromArray(
                    head.descriptor.referenceToActorAtBind,
                  ),
                );
              const rowCaptures: ReturnType<typeof captureSceneJoinActor>[] =
                [];
              const nativeRootTranslations: unknown[] = [];
              for (const id of required(frame.snapshot.residentActorIds)) {
                const state = required(
                  frame.snapshot.actors.find((actor) => actor.actorId === id),
                );
                expect(state.attack).toBeNull();
                expect(state.defeated).toBe(false);
                const entry = required(rigs.get(state.color));
                const meshes: InstanceType<typeof SkinnedMesh>[] = [];
                entry.rig.node.traverse((part) => {
                  if (part instanceof SkinnedMesh) meshes.push(part);
                });
                const mesh = required(meshes[head.descriptor.meshIndex]);
                const attachment = required(
                  mesh.skeleton.bones[head.descriptor.headJointIndex],
                );
                const captured = captureSceneJoinActor(
                  frame,
                  id,
                  entry.rig.node,
                  attachment,
                  adjustment,
                  entry.baseline,
                );
                const sourcePin = required(
                  Object.entries(SCENE_JOIN_SOURCE_PINS).find(
                    ([name]) => name === captured.epoch.binding.clipId,
                  )?.[1],
                );
                const rootTranslation = required(
                  entry.rig.node.getObjectByName('root'),
                ).position.toArray();
                // Independent raw source first key, not B/H agreement alone.
                // Legacy FULL extraction preserves this native local baseline
                // while C alone supplies the physical XZ and jump Y transport.
                expect(rootTranslation).toEqual(sourcePin.firstRootTranslation);
                nativeRootTranslations.push({
                  actorId: id,
                  binding: captured.epoch.binding,
                  actual: rootTranslation,
                  expected: sourcePin.firstRootTranslation,
                });
                expect(
                  requests
                    .slice(row * 2, row * 2 + 2)
                    .find((request) => request.actorId === id),
                ).toMatchObject({
                  kind: 'living',
                  epoch: captured.epoch,
                  at: captured.at,
                  side: 'right',
                });
                if (SCENE_PROGRESSION_H_FRAMES.includes(row + 1))
                  captures.push({ ...captured, bFrame: row + 1 });
                rowCaptures.push(captured);
              }
              records.push({
                marker: 'AFTER_ACTUAL_C_CPU_DRAW',
                value: {
                  row: row + 1,
                  snapshot: frame.snapshot,
                  spatial: frame.spatial,
                  captures: rowCaptures,
                  nativeRootTranslations,
                  ledger: ledger.read(),
                },
              });
            },
          }),
        });
        const ownedGame = game;
        await executeSceneProgressionInputPlan({ game: ownedGame, root });
        expect(frameClocks).toEqual(SCENE_PROGRESSION_CLOCKS);
        expect(cpuSceneCalls).toBe(70);
        expect(captures).toHaveLength(20);
        expect(captures.map((captured) => captured.bFrame)).toEqual(
          SCENE_PROGRESSION_H_FRAMES.flatMap((frame) => [frame, frame]),
        );
        expect(requests).toHaveLength(138);
        expect(appliedFrames).toBe(138);
        records.push({ marker: 'ALL_B_PREPARE_REQUESTS', value: requests });
        ledger.beginOracle();
        for (const captured of captures) {
          ledger.beforeH();
          const sample = required(numeric).epochDiagnostic.point(
            captured.epoch,
            captured.at,
            'right',
          );
          ledger.afterH();
          if (sample.kind !== 'transform')
            throw Error(`Unsupported scene join H query: ${sample.reason}`);
          verifySceneJoinOracle(captured, sample.matrix);
          records.push({
            marker: 'INDEPENDENT_H_WORLD',
            value: {
              bFrame: captured.bFrame,
              actorId: captured.actorId,
              at: captured.at,
              epoch: captured.epoch,
              sample,
              displayedWorld: captured.displayedWorld,
              independentCWorld: captured.cWorld,
            },
          });
        }
        ledger.finish();
        expect(peakRigs).toBe(2);
        expect(ownedGame.lastError()).toBeNull();
        records.push({
          marker: 'PASS',
          value: {
            ledger: ledger.read(),
            cpuSceneCalls,
            bFrames: frameClocks.length,
            hObservationFrames: SCENE_PROGRESSION_H_FRAMES,
            actorPreparations: requests.length,
            actorApplications: appliedFrames,
            hQueries: captures.length,
            peakRigs,
            peakStaged,
            sourceBindings: 'prepared-pinned-pack-and-H-equality',
            residentScope: 'materialized-public-actor-rigs-only',
            sourceRootPolicy: 'legacy-full-translation-no-explicit-policy',
            footLockingAccepted: false,
            sourceBobVisualAccepted: false,
            nativeJumpTimingAccepted: false,
            actualWebGL: false,
            sourceLandingAccepted: false,
            physicalLandingAndIdleReturnAccepted: true,
            nativeJumpClipEndpointAccepted: false,
            fullLocomotionCycleAccepted: false,
            compositeRecoveryAccepted: false,
            performanceAccepted: false,
          },
        });
      } finally {
        // Appended after asynchronous acquisition: reverse traversal detaches
        // and disposes the game before the H/pack safety nets and spy restores.
        cleanups.push(() => game?.dispose());
      }
    },
    cleanups,
    (terminal) => {
      records.push({
        marker: 'TERMINAL',
        value: {
          ...terminal,
          ledger: ledger.read(),
          cpuSceneCalls,
          bFrames: frameClocks.length,
          actorPreparations: requests.length,
          actorApplications: appliedFrames,
          capturedActors: captures.length,
          hQueries: ledger.read().hAttempted,
          fullRigs,
          peakRigs,
          staged,
          peakStaged,
          mounted,
          packOwned,
          hOwned,
          packDisposed,
          hDisposed,
        },
      });
      fs.writeFileSync(
        path.join(directory, 'scene-progression-receipt.json'),
        `${JSON.stringify(records, null, 2)}\n`,
        { flag: 'wx' },
      );
    },
  );
}, 60_000);

// @vitest-environment jsdom
/** Expected RED until actual B checkpoint2 is accepted. No poseProtocol mocks.
 * Real public host/Core/C/B factories + pinned visuals; ALL attack metadata is
 * the synthetic no-contact timing fixture. CPU renderer double, not WebGL proof. */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
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
        pose.kind === 'recovery'
          ? [pose.epoch.outgoing, pose.epoch.destination]
          : pose.kind === 'living'
            ? [pose.living]
            : isRecoveryPoseEpoch(pose.entry)
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
            : pose.kind === 'recovery'
              ? pose.epoch
              : pose.living;
        for (const stamp of isRecoveryPoseEpoch(epoch)
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
          const epoch = pose.kind === 'recovery' ? pose.epoch : pose.living;
          expect(request).toMatchObject({
            kind: 'living',
            epoch,
            at: frame.snapshot.clocks.gameTimeMs,
            side: 'right',
          });
          hReserved += isRecoveryPoseEpoch(epoch) ? 2 : 1;
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

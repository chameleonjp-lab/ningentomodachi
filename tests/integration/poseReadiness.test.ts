import { expect, test } from 'vitest';
import {
  clipId,
  durationMs,
  type PoseCatalogBindings,
  type PoseRunPolicy,
} from '../../src/contracts';
import { createGame, type GameOptions } from '../../src/app/createGame';
import { createFixturePorts } from '../core/fixtures/ports';
import { fixtureMotion } from '../core/fixtures/catalog';

function harness(omit?: 'catalog' | 'animation' | 'spatial', startup = false) {
  const fixture = createFixturePorts();
  const order: string[] = [];
  const bindings: PoseCatalogBindings = {
    version: 1,
    bindingSetId: 'trusted-fixture',
    clips: ['idle', 'walk', 'run', 'jump', fixtureMotion.clipId].map((id) => ({
      clipId: clipId(id),
      durationMs: durationMs(1000),
      sourceBindingId: `fixture:${id}`,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  let release!: () => void;
  let bound = false;
  let onBind = () => {};
  const protocol = {
    version: 1 as const,
    protocol: 'deterministic-pose-v1' as const,
  };
  const contexts: unknown[] = [];
  const factories = {
    ...fixture.factories,
    catalog(context: Parameters<typeof fixture.factories.catalog>[0]) {
      contexts.push(context);
      return {
        ...fixture.factories.catalog(context),
        get pose() {
          return omit === 'catalog' ? undefined : bindings;
        },
        prepare: () =>
          new Promise<void>((resolve) => {
            release = () => {
              order.push('prepared');
              resolve();
            };
          }),
      };
    },
    spatial(context: Parameters<typeof fixture.factories.spatial>[0]) {
      const original = fixture.factories.spatial(context);
      return {
        ...original,
        ...(omit === 'spatial'
          ? {}
          : {
              poseProtocol: {
                ...protocol,
                bindPreparedCatalog(value: PoseCatalogBindings) {
                  expect(value).toBe(bindings);
                  order.push('bind');
                  bound = true;
                  onBind();
                },
              },
            }),
        commit(
          output: Parameters<typeof original.commit>[0],
          viewport: Parameters<typeof original.commit>[1],
        ) {
          if (output.snapshot.phase !== 'loading') expect(bound).toBe(true);
          return original.commit(output, viewport);
        },
      };
    },
    animation(context: Parameters<typeof fixture.factories.animation>[0]) {
      return {
        ...fixture.factories.animation(context),
        poseProtocol: omit === 'animation' ? undefined : protocol,
      };
    },
  };
  const policy: PoseRunPolicy = {
    version: 1,
    mode: 'deterministic-pose-v1',
    ...(startup
      ? {
          attackStartStance: 'selected-side-kicks-v1' as const,
          startup: {
            version: 1 as const,
            protocol: 'side-kick-startup-matrix-v1' as const,
            durationMs: durationMs(100),
            fixedLiftSign: 1 as const,
          },
        }
      : {}),
  };
  const options: GameOptions & { posePolicy: PoseRunPolicy } = {
    sessionId: 'pose-readiness',
    seed: 1,
    posePolicy: policy,
  };
  const game = createGame(factories, options);
  return {
    game,
    fixture,
    order,
    bindings,
    policy,
    contexts,
    protocol,
    finish: () => release,
    onBind: (callback: () => void) => {
      onBind = callback;
    },
    release: () => release(),
  };
}
for (const missing of ['catalog', 'animation', 'spatial'] as const)
  test(`deterministic mode rejects missing ${missing} before readiness`, async () => {
    const h = harness(missing);
    const loading = h.game.start();
    h.release();
    await expect(loading).rejects.toThrow(/pose/i);
    expect(h.game.hostState().phase).toBe('error');
    expect(h.fixture.outputs.some((o) => o.snapshot.phase === 'ready')).toBe(
      false,
    );
    expect(h.fixture.trace).toContain('catalog.dispose');
    h.game.dispose();
  });
test('prepared catalog binds synchronously before the first ready commit', async () => {
  const h = harness();
  const loading = h.game.start();
  expect(h.game.read()?.phase).toBe('loading');
  expect(h.order).toEqual([]);
  h.release();
  await loading;
  expect(h.order).toEqual(['prepared', 'bind']);
  expect(h.game.read()?.phase).toBe('ready');
  h.game.dispose();
});
test('run policy is copied before asynchronous preparation', async () => {
  const h = harness();
  const loading = h.game.start();
  (h.policy as { mode: string }).mode = 'legacy';
  h.release();
  await loading;
  expect(h.contexts[0]).toMatchObject({
    posePolicy: { version: 1, mode: 'deterministic-pose-v1' },
  });
  expect(h.order).toContain('bind');
  h.game.dispose();
});
for (const kind of ['missing-locomotion', 'duplicate', 'duration'] as const)
  test(`invalid ${kind} binding coverage never binds or becomes ready`, async () => {
    const h = harness();
    const loading = h.game.start();
    const clips = h.bindings.clips as Array<{
      clipId: ReturnType<typeof clipId>;
      durationMs: ReturnType<typeof durationMs>;
      sourceBindingId: string;
    }>;
    if (kind === 'missing-locomotion') clips.shift();
    if (kind === 'duplicate') clips.push(clips[0]!);
    if (kind === 'duration')
      clips[clips.length - 1]!.durationMs = durationMs(999);
    h.release();
    await expect(loading).rejects.toThrow(/pose/i);
    expect(h.order).not.toContain('bind');
    h.game.dispose();
  });

test('legacy default does not require or activate pose consumers', async () => {
  const f = createFixturePorts();
  const game = createGame(f.factories, { sessionId: 'legacy', seed: 1 });
  await game.start();
  expect(game.read()?.phase).toBe('ready');
  game.dispose();
});
test('wrong actual display version rejects before bind', async () => {
  const h = harness();
  const loading = h.game.start();
  (h.protocol as { version: number }).version = 2;
  h.release();
  await expect(loading).rejects.toThrow(/pose/i);
  expect(h.order).not.toContain('bind');
  h.game.dispose();
});
test('a binding failure disposes acquired resources and a fresh retry binds once', async () => {
  const h = harness();
  h.onBind(() => {
    throw new Error('pose binding rejected');
  });
  const first = h.game.start();
  h.release();
  await expect(first).rejects.toThrow('pose binding rejected');
  expect(h.fixture.trace).toContain('animation.dispose');
  expect(h.fixture.trace).toContain('spatial.dispose');
  h.onBind(() => {});
  const second = h.game.start();
  h.release();
  await second;
  expect(h.game.read()?.phase).toBe('ready');
  expect(h.contexts).toHaveLength(2);
  h.game.dispose();
});
test('late old load never binds after stop and successor startup', async () => {
  const h = harness();
  const old = h.game.start();
  const finishOld = h.finish();
  h.game.stop();
  const next = h.game.start();
  h.release();
  await next;
  const run = h.game.read()?.runId;
  finishOld();
  await old;
  expect(h.order.filter((v) => v === 'bind')).toHaveLength(1);
  expect(h.game.read()?.runId).toBe(run);
  h.game.dispose();
});
test('synchronous stop during binding cannot publish ready', async () => {
  const h = harness();
  h.onBind(() => h.game.stop());
  const loading = h.game.start();
  h.release();
  await loading;
  expect(h.game.read()).toBeNull();
  expect(h.fixture.outputs.some((o) => o.snapshot.phase === 'ready')).toBe(
    false,
  );
  h.game.dispose();
});

test('startup readiness rejects deterministic-only display before binding or ready', async () => {
  const h = harness(undefined, true);
  const loading = h.game.start();
  h.release();
  await expect(loading).rejects.toThrow(/startup/i);
  expect(h.order).not.toContain('bind');
  expect(h.fixture.outputs.some((o) => o.snapshot.phase === 'ready')).toBe(
    false,
  );
  h.game.dispose();
});

test('invalid optional crouch binding rejects before readiness or pose binding', async () => {
  const h = harness();
  (h.bindings.locomotion as { crouch?: ReturnType<typeof clipId> }).crouch =
    clipId('missing-crouch');
  const loading = h.game.start();
  h.release();
  await expect(loading).rejects.toThrow(/crouch/i);
  expect(h.order).not.toContain('bind');
  expect(h.fixture.outputs.some((o) => o.snapshot.phase === 'ready')).toBe(
    false,
  );
  h.game.dispose();
});

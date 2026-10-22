// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import {
  createIntegrationFixture,
  metrics,
  pointer,
} from './fixtures/integration';
const fixtures: ReturnType<typeof createIntegrationFixture>[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
});
const make = (options: Parameters<typeof createIntegrationFixture>[0] = {}) => {
  const fixture = createIntegrationFixture(options);
  fixtures.push(fixture);
  return fixture;
};
async function start(f: ReturnType<typeof make>) {
  expect(f.game.hostState().phase).toBe('title');
  f.click('はじめる');
  expect(f.game.hostState().phase).toBe('loading');
  await finishStartup(f);
}
async function finishStartup(f: ReturnType<typeof make>) {
  await expect
    .poll(() => f.game.hostState().startup?.requiredAssetsReady)
    .toBe(true);
  const acceptedBefore = f.events.filter(
    (event) => event.type === 'AttackAccepted',
  ).length;
  expect(f.game.hostState().startup?.countdown).toBe(3);
  expect(f.game.read()?.phase).not.toBe('running');
  f.tap('punch');
  f.game.advance(1000);
  expect(f.game.hostState().startup?.countdown).toBe(2);
  f.game.advance(1000);
  expect(f.game.hostState().startup?.countdown).toBe(1);
  f.game.advance(999);
  expect(f.game.read()?.phase).not.toBe('running');
  expect(
    f.events.filter((event) => event.type === 'AttackAccepted'),
  ).toHaveLength(acceptedBefore);
  f.game.advance(1);
  expect(f.game.hostState().startup).toBeNull();
  expect(f.game.hostState().phase).toBe('playing');
  expect(f.game.read()?.phase).toBe('running');
  expect(f.game.read()?.clocks.gameTimeMs).toBe(0);
  f.bars();
}
function advanceChunks(f: ReturnType<typeof make>, elapsed: number) {
  while (elapsed > 0) {
    const step = Math.min(10, elapsed);
    f.game.advance(step);
    elapsed -= step;
  }
}
function finishOpponent(f: ReturnType<typeof make>) {
  const stage = f.game.read()?.presentation;
  if (stage?.kind !== 'opponent-defeat') throw Error('missing opponent defeat');
  advanceChunks(
    f,
    stage.endsAt - (f.game.read()?.clocks.presentationTimeMs ?? 0),
  );
  expect(f.game.read()?.presentation).toMatchObject({
    kind: 'opponent-defeat-finish',
    actorId: stage.actorId,
    startedAt: stage.startedAt,
    endsAt: stage.startedAt + 1625,
  });
  expect(f.game.read()?.currentOpponentId).toBeNull();
  expect(
    f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('0');
  advanceChunks(f, 124);
  expect(f.game.read()?.presentation.kind).toBe('opponent-defeat-finish');
  f.game.advance(1);
  expect(f.game.read()?.clocks.presentationTimeMs).toBe(stage.startedAt + 1625);
  expect(f.game.read()?.currentOpponentId).toBeNull();
  expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(1);
  // The 10ms simulation lattice retires on the next admitted tick, never early.
  f.game.advance(5);
  expect(f.game.read()?.presentation.kind).toBe('none');
  expect(f.game.read()?.currentOpponentId).not.toBeNull();
}
test('actual Core accepts D button input after readiness and emits damage consumed by HUD', async () => {
  const f = make();
  await start(f);
  f.setMode('white');
  f.tap('punch');
  expect(
    f.game.read()?.actors.find((a) => a.color === 'white')?.attack,
  ).toBeNull();
  f.game.advance(10);
  const damage = f.events.find((e) => e.type === 'HpChanged');
  expect(damage).toMatchObject({
    actualHpLost: 150,
    beforeHp: 500,
    afterHp: 350,
  });
  expect(f.events.some((e) => e.type === 'AttackAccepted')).toBe(true);
  expect(
    f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('350');
  expect(f.root.querySelector('.nt-hp-red:not([hidden])')).not.toBeNull();
  expect(f.root.querySelector('.nt-particle:not([hidden])')).not.toBeNull();
  // Synthetic DOM enemy anchor is x=250 root CSS pixels, player anchor x=50.
  // Projection was x=150. No DPR multiplication or falling-body retargeting.
  f.game.advance(390);
  const particle = f.root.querySelector<HTMLElement>(
    '.nt-particle:not([hidden])',
  );
  const x = Number(
    particle?.style.transform.match(/translate\(([-.\d]+)px/)?.[1],
  );
  expect(x).toBeGreaterThan(230);
  expect(x).toBeLessThan(260);
  f.game.advance(400);
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  expect(
    f.game.read()?.actors.find((a) => a.actorId === damage?.actorId)?.hp,
  ).toBe(350);
});
test('held movement and competing action intents follow Core arbitration; pause preempts queued commands', async () => {
  const f = make();
  await start(f);
  pointer(f.control('move'), 'pointerdown', 1);
  f.rotateBasis();
  pointer(f.control('move'), 'pointermove', 1, 144, 436);
  f.game.advance(10);
  f.tap('jump', 2);
  f.tap('punch', 3);
  f.game.advance(10);
  expect(f.sessions).toHaveLength(1);
  expect(
    f.intents.some(
      (i) => i.type === 'MoveRequested' && i.basisRevision === 1 && i.z > 0,
    ),
  ).toBe(true);
  expect(f.events.filter((e) => e.type === 'AttackAccepted')).toHaveLength(1);
  f.tap('kick', 4);
  f.click('設定');
  const count = f.events.filter((e) => e.type === 'AttackAccepted').length;
  f.game.advance(1000);
  expect(f.events.filter((e) => e.type === 'AttackAccepted')).toHaveLength(
    count,
  );
  expect(f.ended).toContain(f.sessions[0]);
  const state = f.game.read();
  if (!state) throw Error('missing state');
  f.game.dispatch({ type: 'Backgrounded', runId: state.runId });
  f.click('設定を閉じる');
  expect(f.game.read()?.pauseReasons).toEqual(
    expect.arrayContaining(['background', 'interruption']),
  );
  f.game.dispatch({ type: 'Foregrounded', runId: state.runId });
  f.click('中断から再開');
  expect(f.game.read()?.phase).toBe('running');
  const before = f.intents.length;
  f.game.advance(10);
  expect(f.intents.slice(before).some((i) => i.type === 'MoveRequested')).toBe(
    false,
  );
});
test('failure retry and title restart preserve shell while stale run controls cannot leak', async () => {
  const f = make({ failFirst: true });
  f.click('はじめる');
  await expect.poll(() => f.game.hostState().phase).toBe('error');
  expect(f.root.textContent).toContain('TEST source unavailable');
  f.click('再試行');
  await finishStartup(f);
  const old = f.game.read();
  if (!old) throw Error('missing state');
  pointer(f.control('move'), 'pointerdown', 1);
  f.game.request({ type: 'ReturnToTitleRequested', requestId: 'test-title' });
  expect(f.game.hostState().phase).toBe('title');
  await start(f);
  expect(f.game.read()?.runId).not.toBe(old.runId);
  pointer(document.body, 'pointermove', 1, 200, 400);
  f.game.advance(10);
  expect(f.intents.filter((i) => i.runId === f.game.read()?.runId)).toEqual([]);
});
test('real damage then defeat healing clears player red history while preserving enemy loss', async () => {
  const f = make();
  await start(f);
  f.setMode('enemy');
  f.game.advance(10);
  expect(f.game.read()?.actors.find((a) => a.color === 'white')?.hp).toBe(350);
  f.setMode('white');
  for (let i = 0; i < 4; i++) {
    f.tap('punch');
    f.game.advance(10);
  }
  expect(f.events.find((e) => e.type === 'Healed')).toMatchObject({
    actualHpGained: 100,
    afterHp: 450,
  });
  expect(
    f.root.querySelectorAll('.nt-hp')[0]?.getAttribute('aria-valuenow'),
  ).toBe('450');
  expect(
    f.root
      .querySelectorAll('.nt-actor')[0]
      ?.querySelector('.nt-hp-red:not([hidden])'),
  ).toBeNull();
  expect(f.game.read()?.presentation.kind).toBe('opponent-defeat');
  expect(f.game.read()?.currentOpponentId).toBeNull();
  const lethal = f.events.filter((e) => e.type === 'HpChanged').at(-1);
  expect(lethal).toMatchObject({ beforeHp: 50, afterHp: 0, actualHpLost: 50 });
  expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(2);
  const enemyBar = f.root.querySelectorAll('.nt-hp')[1];
  expect(enemyBar?.getAttribute('aria-valuenow')).toBe('0');
  const red = [
    ...(enemyBar?.querySelectorAll<HTMLElement>('.nt-hp-red:not([hidden])') ??
      []),
  ];
  expect(
    red.some((node) => node.style.left === '0%' && node.style.width === '10%'),
  ).toBe(true);
  f.game.advance(390);
  const particles = [
    ...f.root.querySelectorAll<HTMLElement>('.nt-particle:not([hidden])'),
  ];
  expect(particles.length).toBeGreaterThan(0);
  for (const particle of particles) {
    const x = Number(
      particle.style.transform.match(/translate\(([-.\d]+)px/)?.[1],
    );
    expect(x).toBeGreaterThan(230);
    expect(x).toBeLessThan(260);
  }
  expect(f.game.read()?.actors.find((a) => a.color === 'white')?.hp).toBe(450);
  const stage = f.game.read()?.presentation;
  if (!stage || !('endsAt' in stage)) throw Error('missing deadline');
  advanceChunks(
    f,
    stage.endsAt - (f.game.read()?.clocks.presentationTimeMs ?? 0),
  );
  expect(
    [...f.root.querySelectorAll('.nt-number')].some((node) =>
      node.textContent?.startsWith('青 '),
    ),
  ).toBe(true);
  expect(f.game.read()?.presentation.kind).toBe('opponent-defeat-finish');
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  advanceChunks(f, 125);
  f.game.advance(5);
  expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(2);
  expect(f.root.querySelectorAll('.nt-number')[1]?.textContent).toBe(
    '緑 500 / 500',
  );
  expect(
    f.root
      .querySelectorAll('.nt-hp')[1]
      ?.querySelector('.nt-hp-red:not([hidden])'),
  ).toBeNull();
});
test('actual defeat freezes result and reaches results without UI extending authoritative deadline', async () => {
  const f = make();
  await start(f);
  f.setMode('enemy');
  for (let i = 0; i < 4; i++) f.game.advance(10);
  const result = f.game.read()?.result;
  expect(result?.outcome).toBe('defeat');
  expect(result?.score.contributions).toBeDefined();
  expect(f.game.read()?.actors.find((a) => a.color === 'white')?.hp).toBe(0);
  f.game.advance(2000);
  f.game.advance(400);
  expect(f.game.hostState().phase).toBe('results');
  expect(f.game.read()?.result).toEqual(result);
  expect(f.root.querySelector('.nt-panel')?.textContent).toContain(
    '丸め・下限調整',
  );
  expect(f.root.querySelector('.nt-panel')?.textContent).toContain('未達');
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  f.click('再挑戦');
  await expect.poll(() => f.game.hostState().phase).toBe('ready');
  expect(f.game.read()?.result).toBeNull();
});
test('shared viewport update releases held movement and offscreen hit still updates HP without fake flight', async () => {
  const f = make();
  await start(f);
  pointer(f.control('move'), 'pointerdown', 1);
  f.game.updateViewport({ ...metrics, widthCssPx: 844, heightCssPx: 390 });
  expect(f.ended).toContain(f.sessions[0]);
  f.offscreen();
  f.setMode('white');
  f.tap('kick');
  f.game.advance(10);
  expect(
    f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('350');
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  expect(f.root.querySelector('.nt-hp-red:not([hidden])')).not.toBeNull();
});

test('pointer cancellation clears simultaneous held and pending controls before actual Core acceptance', async () => {
  const f = make();
  await start(f);
  pointer(f.control('move'), 'pointerdown', 1);
  pointer(f.control('move'), 'pointermove', 1, 100, 450);
  pointer(f.control('jump'), 'pointerdown', 2);
  pointer(f.control('punch'), 'pointerdown', 3);
  pointer(f.control('move'), 'pointercancel', 1);
  f.game.advance(10);
  expect(f.events.filter((e) => e.type === 'AttackAccepted')).toHaveLength(0);
  expect(f.intents).toEqual([]);
  expect(f.ended).toContain(f.sessions[0]);
  pointer(document.body, 'pointermove', 1, 200, 400);
  pointer(document.body, 'pointerup', 3);
  f.game.advance(10);
  expect(f.intents).toEqual([]);
});

test('actual heat authority locks attack controls and settings pause freezes both authoritative clocks', async () => {
  const f = make();
  await start(f);
  for (let i = 0; i < 7; i++) {
    f.tap('punch');
    f.game.advance(10);
  }
  const actor = f.game.read()?.actors.find((a) => a.color === 'white');
  expect(actor?.heat.amount).toBe(7);
  expect(actor?.actions.punch.allowed).toBe(false);
  expect(f.control('punch').getAttribute('aria-disabled')).toBe('true');
  expect(f.root.querySelector('.nt-heat-label')?.textContent).toContain(
    '7 / 7',
  );
  f.tap('punch');
  f.game.advance(10);
  expect(f.events.filter((e) => e.type === 'AttackAccepted')).toHaveLength(7);
  f.click('設定');
  const clocks = f.game.read()?.clocks;
  f.game.advance(10000);
  expect(f.game.read()?.clocks).toEqual(clocks);
  f.click('設定を閉じる');
  for (let i = 0; i < 700; i++) f.game.advance(10);
  expect(
    f.game.read()?.actors.find((a) => a.color === 'white')?.actions.punch
      .allowed,
  ).toBe(true);
  expect(f.control('punch').getAttribute('aria-disabled')).toBe('false');
});

test('four real encounters retain black 700 maximum and publish supplied clear contributions', async () => {
  const f = make();
  await start(f);
  f.setMode('white');
  for (const color of ['blue', 'green', 'yellow', 'black']) {
    const snapshot = f.game.read();
    const enemy = snapshot?.actors.find(
      (a) => a.actorId === snapshot.currentOpponentId,
    );
    expect(enemy?.color).toBe(color);
    expect(
      f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuemax'),
    ).toBe(color === 'black' ? '700' : '500');
    f.bars();
    for (let i = 0; i < (color === 'black' ? 5 : 4); i++) {
      f.tap('punch');
      f.game.advance(10);
    }
    if (color !== 'black') {
      finishOpponent(f);
    }
  }
  const result = f.game.read()?.result;
  expect(result?.outcome).toBe('clear');
  const blackBar = f.root.querySelectorAll('.nt-hp')[1];
  expect(blackBar?.getAttribute('aria-valuemax')).toBe('700');
  expect(blackBar?.getAttribute('aria-valuenow')).toBe('0');
  const lethal = f.events.filter((event) => event.type === 'HpChanged').at(-1);
  expect(lethal).toMatchObject({
    beforeHp: 100,
    afterHp: 0,
    actualHpLost: 100,
    maxHp: 700,
  });
  const lethalRed = [
    ...(blackBar?.querySelectorAll<HTMLElement>('.nt-hp-red:not([hidden])') ??
      []),
  ].find((node) => node.style.left === '0%');
  expect(Number.parseFloat(lethalRed?.style.width ?? 'NaN')).toBeCloseTo(
    (100 / 700) * 100,
  );
  f.game.advance(390);
  const particles = [
    ...f.root.querySelectorAll<HTMLElement>('.nt-particle:not([hidden])'),
  ];
  expect(particles.length).toBeGreaterThan(0);
  for (const particle of particles)
    expect(
      Number(particle.style.transform.match(/translate\(([-.\d]+)px/)?.[1]),
    ).toBeGreaterThan(230);

  expect(result?.score.defeatedEnemies).toBe(4);
  expect(result?.score.remainingHp).toBe(500);
  const stage = f.game.read()?.presentation;
  if (!stage || !('endsAt' in stage)) throw Error('missing terminal deadline');
  advanceChunks(
    f,
    stage.endsAt - (f.game.read()?.clocks.presentationTimeMs ?? 0),
  );
  f.game.advance(400);
  expect(f.game.hostState().phase).toBe('results');
  expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(1);
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  const contribution = result?.score.contributions;
  if (!contribution) throw Error('missing contributions');
  const labels: Record<string, number> = {
    生存点: contribution.survival,
    撃破点: contribution.defeats,
    残HP点: contribution.remainingHp,
    クリア点: contribution.clear,
    速攻点: contribution.speed,
    損壊点: contribution.destruction,
    '丸め・下限調整': contribution.adjustment,
  };
  for (const [label, value] of Object.entries(labels)) {
    const dt = [...f.root.querySelectorAll('dt')].find(
      (node) => node.textContent === label,
    );
    expect(dt?.nextElementSibling?.textContent).toBe(String(value));
  }
});

test('retained defeat HUD is disposed on new run and skipped frames never replay expired loss', async () => {
  const f = make();
  await start(f);
  f.setMode('white');
  for (let i = 0; i < 4; i++) {
    f.tap('punch');
    f.game.advance(10);
  }
  expect(
    f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('0');
  expect(f.root.querySelector('.nt-particle:not([hidden])')).not.toBeNull();
  const old = f.game.read()?.runId;
  f.game.request({
    type: 'ReturnToTitleRequested',
    requestId: 'during-defeat',
  });
  expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(0);
  await start(f);
  expect(f.game.read()?.runId).not.toBe(old);
  expect(
    f.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('500');
  expect(f.root.querySelector('.nt-hp-red:not([hidden])')).toBeNull();
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  for (let i = 0; i < 4; i++) {
    f.tap('punch');
    f.game.advance(10);
  }
  expect(f.root.querySelector('.nt-particle:not([hidden])')).not.toBeNull();
  f.game.advance(5000);
  expect(
    [...f.root.querySelectorAll('.nt-number')].some((node) =>
      node.textContent?.startsWith('青 '),
    ),
  ).toBe(false);
  expect(f.root.querySelector('.nt-hp-red:not([hidden])')).toBeNull();
  expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
});

test.each(['blue', 'black'] as const)(
  'simultaneous lethal %s keeps both capped loss displays but preserves defeat priority',
  async (color) => {
    const f = make();
    await start(f);
    if (color === 'black') {
      f.setMode('white');
      for (let enemy = 0; enemy < 3; enemy++) {
        for (let i = 0; i < 4; i++) {
          f.tap('punch');
          f.game.advance(10);
        }
        finishOpponent(f);
      }
      f.bars();
      f.tap('punch');
      f.game.advance(10);
    }
    const eventStart = f.events.length;
    f.setMode('both');
    for (let i = 0; i < 4; i++) {
      f.tap('punch');
      f.game.advance(10);
    }
    const state = f.game.read();
    if (!state) throw Error('missing snapshot');
    const white = state.actors.find((a) => a.color === 'white');
    const enemy = state.actors.find(
      (a) => a.actorId === state.currentOpponentId,
    );
    expect(white).toMatchObject({ hp: 0, defeated: true });
    expect(enemy).toMatchObject({ color, hp: 0, defeated: true });
    const finalLosses = f.events
      .slice(eventStart)
      .filter((event) => event.type === 'HpChanged')
      .slice(-2);
    expect(finalLosses).toHaveLength(2);
    expect(finalLosses[0]?.batchId).toBe(finalLosses[1]?.batchId);
    expect(
      finalLosses.find((event) => event.actorId === white?.actorId),
    ).toMatchObject({ beforeHp: 50, afterHp: 0, actualHpLost: 50 });
    expect(
      finalLosses.find((event) => event.actorId === enemy?.actorId),
    ).toMatchObject({
      beforeHp: color === 'black' ? 100 : 50,
      afterHp: 0,
      actualHpLost: color === 'black' ? 100 : 50,
    });
    expect(
      f.events.slice(eventStart).some((event) => event.type === 'Healed'),
    ).toBe(false);
    expect(state.presentation.kind).toBe('defeat-slow');
    const result = state.result;
    expect(result).toMatchObject({
      outcome: 'defeat',
      score: {
        defeatedEnemies: color === 'black' ? 4 : 1,
        remainingHp: 0,
        clearTime: null,
      },
    });
    const bars = f.root.querySelectorAll('.nt-hp');
    expect(bars).toHaveLength(2);
    for (const [index, max, loss] of [
      [0, 500, 50],
      [1, color === 'black' ? 700 : 500, color === 'black' ? 100 : 50],
    ] as const) {
      const bar = bars[index];
      expect(bar?.getAttribute('aria-valuenow')).toBe('0');
      expect(bar?.getAttribute('aria-valuemax')).toBe(String(max));
      const red = [
        ...(bar?.querySelectorAll<HTMLElement>('.nt-hp-red:not([hidden])') ??
          []),
      ].find((node) => node.style.left === '0%');
      expect(Number.parseFloat(red?.style.width ?? 'NaN')).toBeCloseTo(
        (loss / max) * 100,
      );
    }
    f.game.advance(390);
    const xs = [
      ...f.root.querySelectorAll<HTMLElement>('.nt-particle:not([hidden])'),
    ].map((particle) =>
      Number(particle.style.transform.match(/translate\(([-.\d]+)px/)?.[1]),
    );
    expect(xs.some((x) => x > 40 && x < 70)).toBe(true);
    expect(xs.some((x) => x > 230 && x < 260)).toBe(true);
    const stage = state.presentation;
    if (!('endsAt' in stage)) throw Error('missing deadline');
    f.game.advance(
      stage.endsAt - (f.game.read()?.clocks.presentationTimeMs ?? 0),
    );
    expect(f.root.querySelectorAll('.nt-hp')).toHaveLength(1);
    expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
    f.game.advance(400);
    expect(f.game.hostState().phase).toBe('results');
    expect(f.game.read()?.result).toEqual(result);
    expect(
      f.game.read()?.actors.find((a) => a.actorId === enemy?.actorId)?.hp,
    ).toBe(0);
    expect(
      f.game.read()?.actors.find((a) => a.actorId === white?.actorId)?.hp,
    ).toBe(0);
    expect(f.root.querySelector('.nt-panel')?.textContent).toContain('未達');
    f.click('再挑戦');
    await expect.poll(() => f.game.hostState().phase).toBe('ready');
    expect(f.game.read()?.runId).not.toBe(state.runId);
    expect(f.root.querySelector('.nt-hp-red:not([hidden])')).toBeNull();
    expect(f.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  },
);

test('actual host countdown finishing before required assets cannot start or accept input', async () => {
  let release: (() => void) | undefined;
  const prepareWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = make({ prepareWait });
  f.click('はじめる');
  f.game.advance(2999);
  expect(f.game.hostState().startup).toMatchObject({
    countdown: 1,
    requiredAssetsReady: false,
  });
  f.tap('punch');
  f.game.advance(1);
  expect(f.game.hostState().phase).toBe('loading');
  expect(f.game.hostState().startup).toMatchObject({
    countdown: 0,
    requiredAssetsReady: false,
  });
  expect(f.game.read()?.phase).not.toBe('running');
  expect(f.events.some((e) => e.type === 'AttackAccepted')).toBe(false);
  expect(f.root.textContent).toContain('読み込み完了を待');
  release?.();
  await expect.poll(() => f.game.hostState().phase).toBe('playing');
  expect(f.game.hostState().startup).toBeNull();
  expect(f.game.read()?.clocks.gameTimeMs).toBe(0);
  const run = f.game.read()?.runId;
  f.game.advance(10);
  expect(f.game.read()?.runId).toBe(run);
  expect(f.events.some((e) => e.type === 'AttackAccepted')).toBe(false);
});

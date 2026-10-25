// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createInterface } from '../../src/ui';
import { frame, run, snapshot, viewport } from './fixtures/core';
import {
  type HostRequest,
  type HostSnapshot,
  type StartupState,
  gameTimeMs,
  runId,
} from '../../src/contracts';
function state(
  phase: HostSnapshot['phase'],
  game: HostSnapshot['game'] = null,
): HostSnapshot {
  return {
    revision: 1,
    phase,
    game,
    runId: game?.runId ?? null,
    error: phase === 'error' ? '素材を読み込めません' : null,
    viewport,
  };
}
function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = createInterface(root);
  const host = ui.host({ read: () => viewport, subscribe: () => () => {} });
  const requests: HostRequest[] = [];
  host.subscribe((r) => requests.push(r));
  return {
    root,
    ui,
    host,
    requests,
    click: (text: string) => {
      const button = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === text,
      );
      expect(button).toBeDefined();
      if (!button) throw Error('Expected button');
      button.click();
    },
  };
}
test('persistent title/loading/error/retry shell survives run disposal and readiness never invents progress', () => {
  const s = setup();
  s.host.render(state('title'));
  s.click('はじめる');
  expect(s.requests.at(-1)?.type).toBe('PrepareRequested');
  s.host.render(state('loading'));
  expect(s.root.textContent).toContain('読込中');
  expect(s.root.querySelector('.nt-panel')?.textContent).not.toMatch(/\d+%/);
  s.host.render(state('error'));
  s.click('再試行');
  expect(s.requests.at(-1)?.type).toBe('RetryRequested');
  s.host.render(state('ready', snapshot({ phase: 'ready' })));
  s.click('プレイ開始');
  expect(s.requests.at(-1)?.type).toBe('StartRequested');
  const runUi = s.ui.ui({
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    request: () => {},
  });
  runUi.dispose();
  s.host.render(state('error'));
  expect(s.root.textContent).toContain('再試行');
  s.host.dispose();
  expect(s.root.children).toHaveLength(0);
  s.root.remove();
});
test('settings closing resumes only settings reason, never background or interruption', () => {
  const s = setup();
  s.host.render(state('playing', snapshot()));
  s.click('設定');
  expect(s.requests.at(-1)).toMatchObject({
    type: 'CommandRequested',
    command: { type: 'PauseRequested', reason: 'settings' },
  });
  s.host.render(
    state(
      'playing',
      snapshot({
        phase: 'paused',
        pauseReasons: ['settings', 'background', 'interruption'],
      }),
    ),
  );
  s.click('設定を閉じる');
  expect(s.requests.at(-1)).toMatchObject({
    type: 'CommandRequested',
    command: { type: 'ResumeRequested', reason: 'settings' },
  });
  expect(
    s.requests.filter(
      (r) =>
        r.type === 'CommandRequested' &&
        r.command.type === 'ResumeRequested' &&
        r.command.reason !== 'settings',
    ),
  ).toEqual([]);
  s.host.dispose();
  s.root.remove();
});
test('actual HUD displays authoritative HP and result values including defeat and unmet clear', () => {
  const s = setup();
  const runUi = s.ui.ui({
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    request: () => {},
  });
  runUi.render(frame(), []);
  expect(s.root.textContent).toContain('700 / 700');
  const result = {
    outcome: 'defeat' as const,
    finalizedAt: gameTimeMs(180000),
    score: {
      defeatedEnemies: 2,
      remainingHp: 0,
      survivalTime: gameTimeMs(180000),
      clearTime: null,
      streetDestructionRate: 0.1,
      vehicleDestructionRate: 0.3,
      destructionPenalty: 600,
      total: 1760,
    },
  };
  s.host.render(state('results', snapshot({ phase: 'terminal', result })));
  expect(s.root.textContent).toContain('1,760');
  expect(s.root.textContent).toContain('未達');
  expect(s.root.textContent).toContain('敗北');
  runUi.dispose();
  s.host.dispose();
  s.root.remove();
});
test('loading failure interrupts settings so retry is never hidden behind a stale dialog', () => {
  const s = setup();
  s.host.render(state('playing', snapshot()));
  s.click('設定');
  s.host.render(state('error'));
  expect(s.root.querySelector('.nt-panel')?.textContent).toContain('再試行');
  expect(s.root.querySelector('.nt-panel')?.textContent).not.toContain(
    '設定を閉じる',
  );
  s.host.dispose();
  s.root.remove();
});
test('settings exposes quality request without inventing device performance or resuming play', () => {
  const s = setup();
  s.host.render(state('playing', snapshot()));
  s.click('設定');
  s.click('低負荷');
  expect(s.requests.at(-1)).toMatchObject({
    type: 'CommandRequested',
    command: { type: 'QualityChanged', quality: 'low' },
  });
  expect(
    s.root.querySelector('[aria-label="操作配置プレビュー"]'),
  ).not.toBeNull();
  s.host.dispose();
  s.root.remove();
});
test('authoritative quality change refreshes settings without changing pause reasons', () => {
  const s = setup();
  s.host.render(state('playing', snapshot()));
  s.click('設定');
  s.host.render(
    state(
      'playing',
      snapshot({ quality: 'low', phase: 'paused', pauseReasons: ['settings'] }),
    ),
  );
  expect(s.root.querySelector('.nt-panel')?.textContent).toContain(
    '表示品質：低負荷',
  );
  s.host.render(
    state(
      'playing',
      snapshot({
        quality: 'standard',
        phase: 'paused',
        pauseReasons: ['settings'],
      }),
    ),
  );
  expect(s.root.querySelector('.nt-panel')?.textContent).toContain(
    '表示品質：標準',
  );
  s.host.dispose();
  s.root.remove();
});
test('open settings preview follows viewport changes without replacing focused controls or saving clamped values', () => {
  const root = document.createElement('div');
  document.body.append(root);
  let current = viewport;
  let onViewport: (value: typeof viewport) => void = () => {};
  const writes: string[] = [];
  const ui = createInterface(root, {
    storage: {
      getItem: () => null,
      setItem: (_key, value) => {
        writes.push(value);
      },
    },
  });
  const host = ui.host({
    read: () => current,
    subscribe: (listener) => {
      onViewport = listener;
      return () => {};
    },
  });
  host.render(state('title'));
  [...root.querySelectorAll('button')]
    .find((button) => button.textContent === '設定')
    ?.click();
  const panel = root.querySelector('.nt-panel');
  const preview = root.querySelector<HTMLElement>('.nt-preview');
  const slider = root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  if (!preview || !slider) throw Error('Expected settings preview and slider');
  slider.value = '0.7';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.focus();
  expect(writes).toHaveLength(0);
  [...root.querySelectorAll('button')]
    .find((button) => button.textContent === '設定を保存')
    ?.click();
  const saved = writes.at(-1);
  const count = writes.length;
  expect(count).toBe(1);
  expect(saved).toBeDefined();
  for (const [widthCssPx, heightCssPx] of [
    [844, 390],
    [320, 568],
    [390, 844],
  ] as const) {
    current = {
      ...viewport,
      widthCssPx,
      heightCssPx,
      revision: current.revision + 1,
    };
    onViewport(current);
    expect(preview.style.aspectRatio).toBe(
      `${current.widthCssPx} / ${current.heightCssPx}`,
    );
    const dots = [...preview.querySelectorAll('span')];
    expect(dots).toHaveLength(3);
    const controls = [...root.querySelectorAll<HTMLElement>('.nt-control')];
    dots.forEach((dot, index) => {
      const control = controls[index];
      if (!control) throw Error('Expected live control');
      expect(parseFloat(dot.style.left)).toBeCloseTo(
        (100 * parseFloat(control.style.left)) / current.widthCssPx,
      );
      expect(parseFloat(dot.style.top)).toBeCloseTo(
        (100 * parseFloat(control.style.top)) / current.heightCssPx,
      );
      expect(parseFloat(dot.style.width)).toBeCloseTo(
        (100 * parseFloat(control.style.width)) / current.widthCssPx,
      );
      expect(parseFloat(dot.style.height)).toBeCloseTo(
        (100 * parseFloat(control.style.height)) / current.heightCssPx,
      );
      expect(dot.style.opacity).toBe(control.style.opacity);
    });
    expect(root.querySelector('.nt-panel')).toBe(panel);
    expect(document.activeElement).toBe(slider);
    expect(slider.value).toBe('0.7');
    expect(writes).toHaveLength(count);
    expect(writes.at(-1)).toBe(saved);
  }
  host.dispose();
  root.remove();
});

const focusCleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of focusCleanups.splice(0)) cleanup();
});
function focusSetup() {
  const s = setup();
  focusCleanups.push(() => {
    s.host.dispose();
    s.root.remove();
  });
  const find = (label: string) => {
    const control = [...s.root.querySelectorAll('button')].find(
      (node) => node.textContent === label,
    );
    if (!control) throw Error(`Missing button: ${label}`);
    return control;
  };
  return { ...s, find };
}
function startupState(
  countdown: StartupState['countdown'],
  generation = 1,
): HostSnapshot & { startup: StartupState } {
  return {
    ...state('loading'),
    startup: {
      generation,
      countdown,
      requiredAssetsReady: false,
      pauseReasons: [],
    },
  };
}
test('owned focus follows the same startup control across countdown and readiness rerenders', () => {
  const s = focusSetup();
  for (const label of ['読込を中止', '設定', '一時停止']) {
    s.host.render(startupState(3));
    const before = s.find(label);
    before.focus();
    s.host.render(startupState(2));
    expect(document.activeElement).toBe(s.find(label));
    expect(s.find(label)).toBe(before);
    const next = startupState(2);
    s.host.render({
      ...next,
      phase: 'ready',
      startup: { ...next.startup, requiredAssetsReady: true },
    });
    expect(document.activeElement).toBe(s.find(label));
  }
  expect(s.requests).toEqual([]);
});
test('settings quality and reset rerenders retain only the focused semantic control', () => {
  const s = focusSetup();
  const paused = (quality: 'standard' | 'low') =>
    state(
      'playing',
      snapshot({ quality, phase: 'paused', pauseReasons: ['settings'] }),
    );
  s.host.render(state('playing', snapshot()));
  s.click('設定');
  const quality = s.find('低負荷');
  quality.focus();
  quality.click();
  s.host.render(paused('low'));
  expect(document.activeElement).toBe(s.find('低負荷'));
  const selector = '[aria-label="パンチ 不透明度"]';
  const slider = s.root.querySelector<HTMLInputElement>(selector);
  if (!slider) throw Error('Missing settings slider');
  slider.value = '0.7';
  slider.dispatchEvent(new Event('input'));
  slider.focus();
  s.host.render(paused('standard'));
  expect(document.activeElement).toBe(s.root.querySelector(selector));
  expect(s.root.querySelector<HTMLInputElement>(selector)?.value).toBe('0.7');
  const reset = s.find('初期配置に戻す');
  reset.focus();
  reset.click();
  expect(document.activeElement).toBe(s.find('初期配置に戻す'));
  expect(
    s.requests.map((request) =>
      request.type === 'CommandRequested' ? request.command.type : request.type,
    ),
  ).toEqual(['PauseRequested', 'QualityChanged']);
});
test('focused detail-zero settings navigation targets the heading then its opener despite synchronous host updates', () => {
  const s = focusSetup();
  s.host.render(state('playing', snapshot()));
  s.host.subscribe((request) => {
    if (request.type !== 'CommandRequested') return;
    if (request.command.type === 'PauseRequested')
      s.host.render(
        state(
          'playing',
          snapshot({ phase: 'paused', pauseReasons: ['settings'] }),
        ),
      );
    if (request.command.type === 'ResumeRequested')
      s.host.render(state('playing', snapshot()));
  });
  const open = s.find('設定');
  open.focus();
  open.click();
  const heading = s.root.querySelector('h2');
  expect(document.activeElement).toBe(heading);
  expect(heading?.tabIndex).toBe(-1);
  const close = s.find('設定を閉じる');
  close.focus();
  close.click();
  expect(document.activeElement).toBe(s.find('設定'));
  expect(
    s.requests.map((request) =>
      request.type === 'CommandRequested' ? request.command.type : request.type,
    ),
  ).toEqual(['PauseRequested', 'ResumeRequested']);
});
test('pointer settings navigation and detail-zero activation without DOM focus never autofocus', () => {
  const s = focusSetup();
  s.host.render(state('title'));
  const open = s.find('設定');
  open.focus();
  open.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(document.activeElement).toBe(document.body);
  const close = s.find('設定を閉じる');
  close.focus();
  close.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(document.activeElement).toBe(document.body);
  s.find('設定').click();
  expect(document.activeElement).toBe(document.body);
  s.find('設定を閉じる').click();
  expect(document.activeElement).toBe(document.body);
});
test('initial rendering and rerenders preserve external focus without assigning shell focus', () => {
  const s = focusSetup();
  const external = document.createElement('button');
  document.body.append(external);
  focusCleanups.push(() => external.remove());
  external.focus();
  s.host.render(state('title'));
  expect(document.activeElement).toBe(external);
  s.find('設定').click();
  expect(document.activeElement).toBe(external);
  s.find('設定を閉じる').click();
  expect(document.activeElement).toBe(external);
  s.host.render(startupState(3));
  s.host.render(startupState(2));
  expect(document.activeElement).toBe(external);
});
test('missing controls and successor startup run or error contexts never inherit stale focus', () => {
  const s = focusSetup();
  s.host.render(startupState(3));
  s.find('読込を中止').focus();
  s.host.render(startupState(3, 2));
  expect(document.activeElement).toBe(document.body);
  s.find('一時停止').focus();
  const paused = startupState(2, 2);
  s.host.render({
    ...paused,
    startup: { ...paused.startup, pauseReasons: ['manual'] },
  });
  expect(document.activeElement).toBe(document.body);
  s.host.render(state('playing', snapshot()));
  s.find('設定').focus();
  s.host.render(
    state('playing', snapshot({ runId: runId('focus-successor') })),
  );
  expect(document.activeElement).toBe(document.body);
  s.find('設定').focus();
  s.host.render(state('error'));
  expect(document.activeElement).toBe(document.body);
  s.find('再試行').focus();
  s.host.render(startupState(3, 3));
  expect(document.activeElement).toBe(document.body);
});
test('rerender leaves gameplay focus alone and detached settings callbacks cannot move successor focus', () => {
  const s = focusSetup();
  s.host.render(state('playing', snapshot()));
  const gameplay = s.find('パンチ');
  gameplay.focus();
  s.host.render(state('playing', snapshot({ quality: 'low' })));
  expect(document.activeElement).toBe(gameplay);
  const staleOpen = s.find('設定');
  s.host.render(startupState(3));
  s.find('設定').click();
  const staleClose = s.find('設定を閉じる');
  s.host.render(startupState(3, 2));
  const current = s.find('読込を中止');
  current.focus();
  const count = s.requests.length;
  staleOpen.click();
  staleClose.click();
  expect(document.activeElement).toBe(current);
  expect(s.requests).toHaveLength(count);
});

test('focused settings navigation returns to the correct title or same-generation startup opener', () => {
  const s = focusSetup();
  for (const next of [state('title'), startupState(2, 5)]) {
    s.host.render(next);
    const count = s.requests.length;
    s.find('設定').focus();
    s.find('設定').click();
    expect(document.activeElement).toBe(s.root.querySelector('h2'));
    s.find('設定を閉じる').focus();
    s.find('設定を閉じる').click();
    expect(document.activeElement).toBe(s.find('設定'));
    if (next.startup)
      expect(s.requests.slice(count)).toMatchObject([
        {
          type: 'StartupPauseRequested',
          startupGeneration: 5,
          reason: 'settings',
        },
        {
          type: 'StartupResumeRequested',
          startupGeneration: 5,
          reason: 'settings',
        },
      ]);
    else expect(s.requests).toHaveLength(count);
  }
});

test('startup text-only changes preserve the status and native control identities', () => {
  const s = focusSetup();
  s.host.render(startupState(3));
  const status = s.root.querySelector('.nt-startup-status');
  const controls = ['設定', '一時停止', '読込を中止'].map(s.find);
  s.host.render(startupState(2));
  expect(s.root.querySelector('.nt-startup-status')).toBe(status);
  expect(status?.textContent).toContain('開始まで 2');
  const next = startupState(0);
  s.host.render({
    ...next,
    startup: { ...next.startup, requiredAssetsReady: true },
  });
  expect(s.root.querySelector('.nt-startup-status')).toBe(status);
  expect(status?.textContent).toContain('開始を準備');
  expect(status?.textContent).toContain('必要な素材の準備ができました');
  ['設定', '一時停止', '読込を中止'].forEach((label, index) => {
    expect(s.find(label)).toBe(controls[index]);
  });
  expect(s.requests).toEqual([]);
});
test('a held startup control still sends exactly its original action after a text-only update', () => {
  for (const [label, expected] of [
    [
      '設定',
      {
        type: 'StartupPauseRequested',
        startupGeneration: 1,
        reason: 'settings',
      },
    ],
    [
      '一時停止',
      { type: 'StartupPauseRequested', startupGeneration: 1, reason: 'manual' },
    ],
    ['読込を中止', { type: 'CancelLoadingRequested' }],
  ] as const) {
    const s = focusSetup();
    s.host.render(startupState(3));
    const held = s.find(label);
    held.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    s.host.render(startupState(2));
    expect(s.find(label)).toBe(held);
    held.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject(expected);
  }
});
test('startup phase run and game attachment changes replace controls and reject detached actions', () => {
  const initial = startupState(3);
  for (const changed of [
    { ...initial, phase: 'ready' as const },
    { ...initial, runId: run },
    { ...initial, game: snapshot({ phase: 'loading' }) },
    { ...initial, runId: run, game: snapshot({ phase: 'loading' }) },
  ]) {
    const s = focusSetup();
    s.host.render(initial);
    const held = ['設定', '一時停止', '読込を中止'].map(s.find);
    s.host.render(changed);
    held.forEach((node) => {
      expect(node.isConnected).toBe(false);
      node.click();
    });
    expect(s.requests).toEqual([]);
    expect(s.root.querySelector('input')).toBeNull();
    s.find('一時停止').click();
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({
      type: 'StartupPauseRequested',
      startupGeneration: 1,
      reason: 'manual',
    });
  }
});
test('changed startup pause authority invalidates old pause cancel and resume actions', () => {
  const s = focusSetup();
  s.host.render(startupState(3));
  const oldPause = s.find('一時停止');
  const oldCancel = s.find('読込を中止');
  const next = startupState(3);
  s.host.render({
    ...next,
    startup: { ...next.startup, pauseReasons: ['manual'] },
  });
  oldPause.click();
  oldCancel.click();
  expect(s.requests).toEqual([]);
  const oldResume = s.find('再開');
  s.host.render(startupState(3));
  oldResume.click();
  expect(s.requests).toEqual([]);
  s.find('読込を中止').click();
  expect(s.requests).toMatchObject([{ type: 'CancelLoadingRequested' }]);
});
test('startup errors cancellation and successor generations discard held controls', () => {
  const initial = startupState(3);
  for (const next of [
    { ...state('error'), startup: initial.startup },
    state('title'),
    startupState(3, 2),
  ]) {
    const s = focusSetup();
    s.host.render(initial);
    const held = ['設定', '一時停止', '読込を中止'].map(s.find);
    s.host.render(next);
    held.forEach((node) => {
      expect(node.isConnected).toBe(false);
      node.click();
    });
    expect(s.requests).toEqual([]);
    expect(s.root.querySelector('input')).toBeNull();
  }
});
test('startup game pause and quality changes do not reuse a captured view authority', () => {
  const initial = {
    ...startupState(3),
    runId: run,
    game: snapshot({ phase: 'loading' }),
  };
  for (const game of [
    snapshot({ phase: 'loading', pauseReasons: ['background'] }),
    snapshot({ phase: 'loading', quality: 'low' }),
  ]) {
    const s = focusSetup();
    s.host.render(initial);
    const held = ['設定', '一時停止', '読込を中止'].map(s.find);
    s.host.render({ ...initial, game });
    held.forEach((node) => {
      expect(node.isConnected).toBe(false);
      node.click();
    });
    expect(s.requests).toEqual([]);
    s.find('読込を中止').click();
    expect(s.requests).toMatchObject([{ type: 'CancelLoadingRequested' }]);
  }
});

test.each([
  ['manual', '再開', 'run'],
  ['manual', '再開', 'pause-authority'],
  ['interruption', '中断から再開', 'run'],
  ['interruption', '中断から再開', 'pause-authority'],
] as const)(
  'detached playing %s resume (%s) cannot clear successor %s',
  (reason, label, transition) => {
    const s = setup();
    const paused = snapshot({ phase: 'paused', pauseReasons: [reason] });
    s.host.render(state('playing', paused));
    const held = [...s.root.querySelectorAll('button')].find(
      (node) => node.textContent === label,
    );
    if (!held) throw Error('Expected resume button');
    const successor = snapshot({
      ...paused,
      runId: transition === 'run' ? runId('successor-run') : run,
      pauseReasons:
        transition === 'pause-authority' ? [reason, 'background'] : [reason],
    });
    s.host.render(state('playing', successor));
    expect(held.isConnected).toBe(false);
    held.click();
    expect(s.requests).toEqual([]);
    s.click(label);
    expect(s.requests).toMatchObject([
      {
        type: 'CommandRequested',
        command: {
          type: 'ResumeRequested',
          runId: successor.runId,
          reason,
        },
      },
    ]);
    s.host.dispose();
    s.root.remove();
  },
);

test('settings scroll and focused lower slider survive authoritative pause and quality rerenders', () => {
  const s = focusSetup();
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  try {
    s.host.render(state('playing', snapshot()));
    s.click('設定');
    const selector = '[aria-label="ジャンプ 不透明度"]';
    const slider = s.root.querySelector<HTMLInputElement>(selector);
    if (!slider) throw Error('Missing settings slider');
    slider.focus();
    const requestsBefore = [...s.requests];
    for (const game of [
      snapshot({
        phase: 'paused',
        pauseReasons: ['settings', 'background', 'interruption'],
      }),
      snapshot({
        phase: 'paused',
        pauseReasons: ['settings', 'interruption'],
        quality: 'low',
      }),
    ]) {
      const previous = s.root.querySelector<HTMLElement>('.nt-panel');
      if (!previous) throw Error('Missing settings panel');
      previous.scrollTop = 417;
      s.host.render(state('playing', game));
      const panel = s.root.querySelector<HTMLElement>('.nt-panel');
      expect(panel).not.toBe(previous);
      expect(panel?.scrollTop).toBe(417);
      expect(document.activeElement).toBe(s.root.querySelector(selector));
    }
    expect(s.requests).toEqual(requestsBefore);
    expect(writes).not.toHaveBeenCalled();
  } finally {
    writes.mockRestore();
  }
});

test('settings reset keeps the current scroll position without requiring focused controls', () => {
  const s = focusSetup();
  s.host.render(state('title'));
  s.click('設定');
  const panel = s.root.querySelector<HTMLElement>('.nt-panel');
  if (!panel) throw Error('Missing settings panel');
  panel.scrollTop = 612;
  s.click('初期配置に戻す');
  expect(s.root.querySelector<HTMLElement>('.nt-panel')?.scrollTop).toBe(612);
  expect(document.activeElement).toBe(document.body);
});

test('settings scroll never carries into closed reopened or successor contexts', () => {
  const s = focusSetup();
  const scroll = () => {
    const panel = s.root.querySelector<HTMLElement>('.nt-panel');
    if (!panel) throw Error('Missing panel');
    panel.scrollTop = 417;
  };
  const expectTop = () =>
    expect(s.root.querySelector<HTMLElement>('.nt-panel')?.scrollTop).toBe(0);
  s.host.render(state('title'));
  s.click('設定');
  scroll();
  s.click('設定を閉じる');
  expectTop();
  s.click('設定');
  expectTop();
  scroll();
  s.host.render(state('playing', snapshot()));
  expectTop();
  scroll();
  s.host.render(state('playing', snapshot({ runId: runId('successor') })));
  expectTop();
  scroll();
  s.host.render(startupState(3));
  expectTop();
  s.click('設定');
  scroll();
  s.host.render(startupState(3, 2));
  expectTop();
  s.click('設定');
  expectTop();
  scroll();
  s.host.render(state('error'));
  expectTop();
});

test('title explains the four opponents without promising street exploration', () => {
  const s = setup();
  s.host.render(state('title'));
  expect(s.root.textContent).toContain('青・緑・黄・黒の4連戦。');
  s.click('はじめる');
  expect(s.requests.at(-1)?.type).toBe('PrepareRequested');
  s.host.dispose();
  s.root.remove();
});

test('legacy rendering and slider edits only save v2 after explicit save while swipe help and native jump remain available', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const oldKey = 'ningentomodachi.controls.v1';
  const raw = JSON.stringify({
    version: 1,
    buttons: Object.fromEntries(
      ['punch', 'kick', 'jump'].map((name) => [
        name,
        { x: 1, y: 1, size: 64, opacity: 0.8 },
      ]),
    ),
  });
  const bytes = new Map([[oldKey, raw]]);
  const writes: string[] = [];
  let current = viewport;
  let notify = (_next: typeof viewport) => {};
  const ui = createInterface(root, {
    storage: {
      getItem: (key) => bytes.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(key);
        bytes.set(key, value);
      },
    },
  });
  const host = ui.host({
    read: () => current,
    subscribe: (listener) => {
      notify = listener;
      return () => {};
    },
  });
  const click = (label: string) => {
    const node = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
    if (!node) throw Error(`Missing ${label}`);
    node.click();
  };
  host.render({ ...state('playing', snapshot()), viewport: current });
  const controls = [...root.querySelectorAll<HTMLButtonElement>('.nt-control')];
  expect(controls.map((node) => node.style.width)).toEqual([
    '80px',
    '80px',
    '48px',
  ]);
  expect(
    controls.every(
      (node) =>
        node.tagName === 'BUTTON' && node.type === 'button' && !node.disabled,
    ),
  ).toBe(true);
  const move = root.querySelector('.nt-swipe');
  expect(move?.textContent).toBe('左右：移動　上：ジャンプ　下：しゃがみ');
  expect(move?.getAttribute('aria-label')).toContain('上：ジャンプ');
  expect(move?.getAttribute('aria-label')).toContain('下：しゃがみ');
  for (const [widthCssPx, heightCssPx] of [
    [844, 390],
    [320, 568],
    [390, 844],
  ] as const) {
    current = {
      ...current,
      widthCssPx,
      heightCssPx,
      revision: current.revision + 1,
    };
    notify(current);
  }
  expect(writes).toEqual([]);
  click('設定');
  const slider = root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  if (!slider) throw Error('Missing slider');
  slider.value = '0.6';
  slider.dispatchEvent(new Event('input'));
  expect(writes).toEqual([]);
  click('設定を閉じる');
  expect(writes).toEqual([]);
  click('設定');
  click('設定を保存');
  expect(writes).toEqual(['ningentomodachi.controls.v2']);
  expect(bytes.get(oldKey)).toBe(raw);
  expect(
    JSON.parse(bytes.get('ningentomodachi.controls.v2') ?? '{}').buttons.punch
      .opacity,
  ).toBe(0.6);
  click('初期配置に戻す');
  expect(writes).toHaveLength(1);
  host.dispose();
  root.remove();
});

test('explicit save denial retains in-memory settings and the existing honest warning', () => {
  const root = document.createElement('main');
  document.body.append(root);
  const save = vi.fn(() => {
    throw Error('quota denied');
  });
  const ui = createInterface(root, {
    storage: { getItem: () => null, setItem: save },
  });
  const host = ui.host({ read: () => viewport, subscribe: () => () => {} });
  const click = (label: string) => {
    const node = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
    if (!node) throw Error(`Missing ${label}`);
    node.click();
  };
  host.render(state('title'));
  click('設定');
  const slider = root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  if (!slider) throw Error('Missing slider');
  slider.value = '0.55';
  slider.dispatchEvent(new Event('input'));
  expect(save).not.toHaveBeenCalled();
  click('設定を保存');
  expect(save).toHaveBeenCalledOnce();
  expect(root.querySelector('.nt-panel')?.textContent).toContain(
    '変更はこのプレイに適用しましたが、端末内に保存できません。',
  );
  expect(root.querySelector<HTMLElement>('.nt-control')?.style.opacity).toBe(
    '0.55',
  );
  click('設定を閉じる');
  click('設定');
  expect(
    root.querySelector<HTMLInputElement>('[aria-label="パンチ 不透明度"]')
      ?.value,
  ).toBe('0.55');
  host.dispose();
  root.remove();
});

test('explicit save after responsive fallback refreshes slider values without replacing focused controls', () => {
  const root = document.createElement('div');
  document.body.append(root);
  let current = viewport;
  let onViewport = (_next: typeof viewport) => {};
  let saved = '';
  const ui = createInterface(root, {
    storage: {
      getItem: () => null,
      setItem: (_key, value) => {
        saved = value;
      },
    },
  });
  const host = ui.host({
    read: () => current,
    subscribe: (listener) => {
      onViewport = listener;
      return () => {};
    },
  });
  host.render(state('title'));
  const click = (label: string) => {
    const node = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
    if (!node) throw Error(`Missing ${label}`);
    node.click();
  };
  click('設定');
  const slider = root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ サイズ"]',
  );
  if (!slider) throw Error('Missing slider');
  slider.focus();
  current = {
    ...current,
    revision: current.revision + 1,
    widthCssPx: 200,
    heightCssPx: 250,
    safeAreaCssPx: { top: 0, bottom: 0, left: 0, right: 0 },
  };
  onViewport(current);
  expect(saved).toBe('');
  expect(slider.value).toBe('80');
  click('設定を保存');
  expect(JSON.parse(saved).buttons.punch.size).toBe(44);
  expect(slider.value).toBe('44');
  expect(document.activeElement).toBe(slider);
  host.dispose();
  root.remove();
});

// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { createInterface } from '../../src/ui';
import { frame, run, snapshot, viewport } from './fixtures/core';
import {
  type HostRequest,
  type HostSnapshot,
  gameTimeMs,
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

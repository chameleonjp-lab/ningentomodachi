// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createInterface } from '../../src/ui';
import type {
  HostSnapshot,
  HostRequest,
  StartupState,
  GameCommand,
} from '../../src/contracts';
import { viewport, run, snapshot } from './fixtures/core';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  vi.useRealTimers();
});
function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = createInterface(root);
  const reader = { read: () => viewport, subscribe: () => () => {} };
  const host = ui.host(reader);
  const requests: HostRequest[] = [];
  host.subscribe((request) => requests.push(request));
  cleanup.push(() => {
    host.dispose();
    root.remove();
  });
  let revision = 0;
  const render = (
    startup: StartupState | null,
    phase: HostSnapshot['phase'] = 'loading',
  ) =>
    host.render({
      revision: ++revision,
      phase,
      game: phase === 'playing' ? snapshot() : null,
      runId: phase === 'playing' ? run : null,
      error: phase === 'error' ? '読込失敗' : null,
      viewport,
      startup,
    });
  const button = (label: string) => {
    const found = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === label,
    );
    if (!found) throw Error(`Missing button ${label}`);
    return found;
  };
  return { root, ui, reader, host, requests, render, button };
}
const startup = (overrides: Partial<StartupState> = {}): StartupState => ({
  generation: 1,
  countdown: 3,
  requiredAssetsReady: false,
  pauseReasons: [],
  ...overrides,
});
test.each([0, 1, 2, 3] as const)(
  'count %i cross readiness never invents completion or emits automatic start',
  (countdown) => {
    const s = setup();
    for (const requiredAssetsReady of [false, true]) {
      s.render(
        startup({ countdown, requiredAssetsReady }),
        requiredAssetsReady ? 'ready' : 'loading',
      );
      const status = s.root.querySelector('.nt-startup-status');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(status?.getAttribute('aria-atomic')).toBe('true');
      expect(s.root.querySelector<HTMLElement>('.nt-controls')?.hidden).toBe(
        true,
      );
      if (countdown > 0)
        expect(status?.textContent).toContain(`開始まで ${countdown}`);
      else
        expect(status?.textContent).toContain(
          requiredAssetsReady ? '開始を準備' : '読み込み完了を待',
        );
      expect(s.root.textContent).not.toContain('プレイ開始');
      expect(status?.textContent).not.toMatch(/\d+%/);
      expect(s.requests).toEqual([]);
    }
  },
);
test('status changes only from host and equal startup updates preserve accessible nodes', () => {
  vi.useFakeTimers();
  const s = setup();
  s.render(startup());
  const status = s.root.querySelector('.nt-startup-status');
  vi.advanceTimersByTime(20000);
  expect(status?.textContent).toContain('開始まで 3');
  s.render(startup());
  expect(s.root.querySelector('.nt-startup-status')).toBe(status);
  s.render(startup({ countdown: 2 }));
  expect(s.root.querySelector('.nt-startup-status')?.textContent).toContain(
    '開始まで 2',
  );
  expect(s.requests).toEqual([]);
});
test('pre-run settings and interruption resume target only captured generation and reason', () => {
  const s = setup();
  s.render(startup({ generation: 7, countdown: 2 }));
  s.button('設定').click();
  expect(s.requests.at(-1)).toMatchObject({
    type: 'StartupPauseRequested',
    startupGeneration: 7,
    reason: 'settings',
  });
  s.render(
    startup({
      generation: 7,
      countdown: 2,
      pauseReasons: ['settings', 'background', 'interruption'],
    }),
  );
  s.button('設定を閉じる').click();
  expect(s.requests.at(-1)).toMatchObject({
    type: 'StartupResumeRequested',
    startupGeneration: 7,
    reason: 'settings',
  });
  s.render(
    startup({
      generation: 7,
      countdown: 2,
      pauseReasons: ['background', 'interruption'],
    }),
  );
  const resume = s.button('中断から再開');
  resume.click();
  expect(s.requests.at(-1)).toMatchObject({
    type: 'StartupResumeRequested',
    startupGeneration: 7,
    reason: 'interruption',
  });
  s.render(startup({ generation: 8 }));
  const count = s.requests.length;
  resume.click();
  expect(s.requests).toHaveLength(count);
  expect(s.root.textContent).toContain('開始まで 3');
  expect(s.requests.some((r) => r.type === 'StartRequested')).toBe(false);
});
test.each([0, 1, 2, 3] as const)(
  'failure/retry at count %i removes old status and rejects old settings/cancel callbacks',
  (countdown) => {
    const s = setup();
    s.render(startup({ generation: 2, countdown }));
    const cancel = s.button('読込を中止');
    s.button('設定').click();
    const close = s.button('設定を閉じる');
    s.render(null, 'error');
    expect(s.root.textContent).not.toContain('開始まで');
    expect(s.root.querySelector('[role=alert]')?.textContent).toBe('読込失敗');
    s.button('再試行').click();
    expect(s.requests.at(-1)?.type).toBe('RetryRequested');
    s.render(startup({ generation: 3 }));
    const count = s.requests.length;
    cancel.click();
    close.click();
    expect(s.requests).toHaveLength(count);
    expect(s.root.textContent).toContain('読込中');
    expect(s.root.textContent).toContain('開始まで 3');
  },
);
test('ordinary playing updates do not reopen loading or gate noncombat controls; A gate alone unlocks gameplay', () => {
  const s = setup();
  const commands: GameCommand[] = [];
  const input = s.ui.input({
    runId: run,
    seed: 1,
    viewport: s.reader,
    readSnapshot: () => snapshot(),
    movement: {
      begin: (sessionId) => ({
        runId: run,
        sessionId,
        revision: 1,
        right: { x: 1, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 1 },
      }),
      end: () => {},
      releaseAll: () => {},
    },
  });
  cleanup.push(() => input.dispose());
  input.subscribe((command) => commands.push(command));
  input.setGate({ runId: run, enabled: false });
  s.render(startup({ countdown: 0, requiredAssetsReady: false }));
  s.button('パンチ').click();
  expect(commands).toEqual([]);
  s.render(null, 'playing');
  input.setGate({ runId: run, enabled: true });
  s.button('パンチ').click();
  expect(commands.at(-1)?.type).toBe('AttackRequested');
  for (let i = 0; i < 3; i++) s.render(null, 'playing');
  expect(s.root.querySelector<HTMLElement>('.nt-controls')?.hidden).toBe(false);
  expect(s.root.querySelector('.nt-startup-status')).toBeNull();
  s.button('設定').click();
  s.button('設定を閉じる').click();
  expect(
    s.requests.some(
      (r) => r.type === 'StartRequested' || r.type === 'PrepareRequested',
    ),
  ).toBe(false);
});

test.each(['manual', 'settings', 'background', 'interruption'] as const)(
  'pause %s remains authoritative across countdown/readiness crossproduct',
  (reason) => {
    const s = setup();
    for (const countdown of [3, 2, 1, 0] as const)
      for (const requiredAssetsReady of [false, true]) {
        s.render(
          startup({ countdown, requiredAssetsReady, pauseReasons: [reason] }),
        );
        expect(s.root.textContent).toContain('開始前の一時停止中');
        expect(s.root.querySelector<HTMLElement>('.nt-controls')?.hidden).toBe(
          true,
        );
        expect(s.requests).toEqual([]);
      }
  },
);
test('settings focus survives required loading completion without resetting countdown or starting', () => {
  const s = setup();
  s.render(startup({ countdown: 2 }));
  s.button('設定').click();
  const slider = s.root.querySelector<HTMLInputElement>('input[type=range]');
  slider?.focus();
  s.render(
    startup({
      countdown: 2,
      requiredAssetsReady: true,
      pauseReasons: ['settings'],
    }),
    'ready',
  );
  expect(s.root.querySelector('input[type=range]')).toBe(slider);
  expect(document.activeElement).toBe(slider);
  expect(s.requests).toMatchObject([
    { type: 'StartupPauseRequested', startupGeneration: 1, reason: 'settings' },
  ]);
});

test('detached title settings opener cannot open successor startup without its pause', () => {
  const s = setup();
  s.render(null, 'title');
  const old = s.button('設定');
  s.render(startup());
  old.click();
  expect(s.root.querySelector('input[type=range]')).toBeNull();
  expect(s.requests).toEqual([]);
  s.button('設定').click();
  expect(s.requests.at(-1)).toMatchObject({
    type: 'StartupPauseRequested',
    startupGeneration: 1,
    reason: 'settings',
  });
});
test('detached generation sliders and reset cannot persist settings into successor', () => {
  const s = setup();
  s.render(startup());
  s.button('設定').click();
  const old = s.root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  const reset = s.button('初期配置に戻す');
  s.render(startup({ generation: 2 }));
  s.button('設定').click();
  const current = s.root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  if (!old || !current) throw Error('Missing slider');
  current.value = '0.6';
  current.dispatchEvent(new Event('input'));
  old.value = '0.9';
  old.dispatchEvent(new Event('input'));
  reset.click();
  s.button('設定を閉じる').click();
  s.button('設定').click();
  expect(
    s.root.querySelector<HTMLInputElement>('[aria-label="パンチ 不透明度"]')
      ?.value,
  ).toBe('0.6');
});
test('closed settings epoch cannot write or close a reopened panel within same generation', () => {
  const s = setup();
  s.render(startup());
  s.button('設定').click();
  const old = s.root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  const close = s.button('設定を閉じる');
  close.click();
  s.button('設定').click();
  const current = s.root.querySelector<HTMLInputElement>(
    '[aria-label="パンチ 不透明度"]',
  );
  if (!old || !current) throw Error('Missing slider');
  current.value = '0.6';
  current.dispatchEvent(new Event('input'));
  const count = s.requests.length;
  old.value = '0.9';
  old.dispatchEvent(new Event('input'));
  close.click();
  expect(s.requests).toHaveLength(count);
  expect(current.isConnected).toBe(true);
  s.button('設定を閉じる').click();
  s.button('設定').click();
  expect(
    s.root.querySelector<HTMLInputElement>('[aria-label="パンチ 不透明度"]')
      ?.value,
  ).toBe('0.6');
});

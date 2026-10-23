// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { createInterface } from '../../src/ui';
import type { ViewportSnapshot } from '../../src/contracts';
import {
  actor,
  frame,
  opponent,
  run,
  snapshot,
  viewport,
} from './fixtures/core';

function setup(initial: ViewportSnapshot = viewport) {
  const root = document.createElement('div');
  document.body.append(root);
  let current = initial;
  let changed: (viewport: ViewportSnapshot) => void = () => {};
  const reader = {
    read: () => current,
    subscribe: (fn: (viewport: ViewportSnapshot) => void) => {
      changed = fn;
      return () => {};
    },
  };
  const factories = createInterface(root);
  const host = factories.host(reader);
  const ui = factories.ui({
    runId: run,
    seed: 1,
    viewport: reader,
    request: () => {},
  });
  host.render({
    revision: 1,
    phase: 'playing',
    game: snapshot(),
    runId: run,
    error: null,
    viewport: initial,
  });
  return {
    root,
    ui,
    resize(next: ViewportSnapshot) {
      current = next;
      changed(next);
    },
    finish() {
      ui.dispose();
      host.dispose();
      root.remove();
    },
  };
}

test('player and enemy occupy semantic opposed slots even when actor order changes', () => {
  const s = setup();
  try {
    s.ui.render(
      frame({
        snapshot: snapshot({ actors: [actor(opponent, 630, 700), actor()] }),
      }),
      [],
    );
    const player = s.root.querySelector<HTMLElement>(
      '[data-hud-side="player"]',
    );
    const enemy = s.root.querySelector<HTMLElement>('[data-hud-side="enemy"]');
    expect(player?.style.gridColumn).toBe('1');
    expect(enemy?.style.gridColumn).toBe('2');
    expect(player?.textContent).toContain('白 500 / 500');
    expect(enemy?.textContent).toContain('黒 630 / 700');
    expect(enemy?.querySelector('.nt-hp')?.getAttribute('aria-valuenow')).toBe(
      '630',
    );
    const enemyTrack = enemy?.querySelector('.nt-hp');
    expect(enemyTrack && getComputedStyle(enemyTrack).transform).toBe(
      'scaleX(-1)',
    );
    expect(enemy && getComputedStyle(enemy).transform).not.toBe('scaleX(-1)');
    expect(enemy?.querySelector<HTMLElement>('.nt-hp-green')?.style.width).toBe(
      '90%',
    );
    s.ui.render(frame({ snapshot: snapshot({ revision: 2 }) }), []);
    expect(s.root.querySelector('[data-hud-side="player"]')).toBe(player);
    expect(s.root.querySelector('[data-hud-side="enemy"]')).toBe(enemy);
  } finally {
    s.finish();
  }
});

test('compact header uses safe-area usable width and switches layout on viewport resize', () => {
  const wide = {
    ...viewport,
    widthCssPx: 800,
    heightCssPx: 400,
    safeAreaCssPx: { top: 10, right: 30, bottom: 20, left: 20 },
  };
  const s = setup(wide);
  try {
    const header = s.root.querySelector<HTMLElement>('.nt-battle-header');
    expect(header?.dataset.layout).toBe('wide');
    expect(header?.style.top).toBe('18px');
    expect(header?.style.left).toBe('32px');
    expect(header?.style.right).toBe('42px');
    expect(header?.querySelector('.nt-hud')).not.toBeNull();
    expect(header?.querySelectorAll('.nt-tools button')).toHaveLength(2);
    for (const button of header?.querySelectorAll('.nt-tools button') ?? []) {
      expect(
        Number.parseFloat(getComputedStyle(button).minWidth),
      ).toBeGreaterThanOrEqual(44);
      expect(
        Number.parseFloat(getComputedStyle(button).minHeight),
      ).toBeGreaterThanOrEqual(44);
    }
    s.resize({ ...wide, revision: 2, widthCssPx: 680 });
    expect(header?.dataset.layout).toBe('narrow');
    expect(header?.querySelectorAll('.nt-tools button')).toHaveLength(2);
  } finally {
    s.finish();
  }
});

test('compact header preserves heat and cooling restriction text for both actors', () => {
  const s = setup();
  try {
    const state = snapshot();
    const actors = state.actors.map((a) => ({
      ...a,
      heat: {
        ...a.heat,
        amount: 7,
        lockedUntil: (state.clocks.activeRealTimeMs +
          3000) as typeof state.clocks.activeRealTimeMs,
      },
      actions: {
        ...a.actions,
        punch: { allowed: false, reason: 'cooling-lock' } as const,
        kick: { allowed: false, reason: 'cooling-lock' } as const,
      },
    }));
    s.ui.render(frame({ snapshot: snapshot({ actors }) }), []);
    for (const side of ['player', 'enemy']) {
      const card = s.root.querySelector(`[data-hud-side="${side}"]`);
      expect(card?.querySelector('.nt-heat-label')?.textContent).toBe(
        '熱量 7 / 7 · 冷却中 · 3.0秒',
      );
      expect(card?.querySelector<HTMLElement>('.nt-heat')?.style.width).toBe(
        '100%',
      );
    }
  } finally {
    s.finish();
  }
});

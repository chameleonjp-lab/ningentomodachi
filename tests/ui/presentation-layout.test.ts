// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createInterface } from '../../src/ui';
import { defaultSettings } from '../../src/ui/settings';
import { actor, frame, run, snapshot, viewport } from './fixtures/core';
import {
  batchId,
  contactId,
  domainEventId,
  gameTimeMs,
  launchId,
  vehicleId,
  presentationTimeMs,
  type CommittedFrame,
  type HpChanged,
  type Projection,
} from '../../src/contracts';
let observer: { callback: ResizeObserverCallback; nodes: Set<Element> };
class Observer {
  nodes = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    observer = this;
  }
  observe(node: Element) {
    this.nodes.add(node);
  }
  unobserve(node: Element) {
    this.nodes.delete(node);
  }
  disconnect() {
    this.nodes.clear();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function setup(controlSize?: number) {
  vi.stubGlobal('ResizeObserver', Observer);
  const fonts = Object.assign(new EventTarget(), {
    status: 'loaded',
    ready: Promise.resolve(),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  const root = document.createElement('div');
  document.body.append(root);
  const configured = {
    ...defaultSettings,
    buttons: Object.fromEntries(
      Object.entries(defaultSettings.buttons).map(([name, value]) => [
        name,
        { ...value, size: controlSize ?? value.size },
      ]),
    ),
  };
  const factories = createInterface(root, {
    storage: { getItem: () => JSON.stringify(configured), setItem: () => {} },
  });
  let currentViewport = viewport;
  let onViewport = (_value: typeof viewport) => {};
  const host = factories.host({
    read: () => currentViewport,
    subscribe: (listener) => {
      onViewport = listener;
      return () => {};
    },
  });
  host.render({
    revision: 1,
    phase: 'playing',
    runId: run,
    game: snapshot(),
    error: null,
    viewport,
  });
  const ui = factories.ui({
    runId: run,
    seed: 1,
    viewport: { read: () => viewport, subscribe: () => () => {} },
    request: () => {},
  });
  const bounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const side =
        this.closest('[data-hud-side]')?.getAttribute('data-hud-side');
      const transform =
        this.closest('.nt-actor-content')?.getAttribute('style') ?? '';
      const shake =
        !media.matches && this.classList.contains('nt-hp')
          ? Number(transform.match(/translateX\(([-.\d]+)px\)/)?.[1] ?? 0)
          : 0;
      const left = (side === 'enemy' ? 210 : 20) + shake;
      return {
        left,
        top: 80,
        right: left + 150,
        bottom: 160,
        width: 150,
        height: 80,
        x: left,
        y: 80,
        toJSON: () => ({}),
      };
    });
  function observe() {
    observer?.callback(
      [...observer.nodes].map((target) => {
        const control = target.closest('button');
        const outerSize = control ? parseFloat(control.style.width) || 44 : 0;
        const content = outerSize - 10;
        const font = outerSize < 56 ? 12 : 14;
        const textHeight = control
          ? Math.ceil(
              (control.textContent?.length ?? 0) /
                Math.max(1, Math.floor(content / font)),
            ) *
            font *
            1.3
          : 80;
        return {
          target,
          contentRect: !control
            ? { width: 150, height: 80 }
            : target === control
              ? { width: content, height: content }
              : target.classList.contains('nt-button-glyphs')
                ? {
                    width: font,
                    height: font * (control.textContent?.length ?? 1),
                  }
                : { width: content, height: textHeight },
        } as ResizeObserverEntry;
      }),
      {} as ResizeObserver,
    );
  }
  function qualify(f: CommittedFrame = frame()) {
    ui.prepareLayout?.(f);
    observe();
    return ui.prepareLayout?.(f);
  }
  return {
    root,
    ui,
    host,
    bounds,
    observe,
    qualify,
    media,
    fonts,
    rotate: (next: typeof viewport) => {
      currentViewport = next;
      onViewport(next);
    },
  };
}
test('measures at most eight visible exclusions and two internal anchors then caches prepare plus render', () => {
  const s = setup();
  expect(s.ui.prepareLayout).toBeTypeOf('function');
  const layout = s.qualify();
  expect(layout?.rects.map((r) => r.id).sort()).toEqual([
    'jump',
    'kick',
    'opponent-status',
    'pause',
    'player-status',
    'punch',
    'settings',
  ]);
  expect(s.bounds.mock.calls.length).toBeLessThanOrEqual(10);
  s.bounds.mockClear();
  const later = frame({
    snapshot: snapshot({
      revision: 2,
      actors: snapshot().actors.map((a) => ({
        ...a,
        hp: a.hp - 0.25,
        heat: { ...a.heat, amount: 2.1 },
      })),
    }),
  });
  expect(s.ui.prepareLayout?.(later)).toBe(layout);
  s.ui.render({ ...later, presentationLayout: layout }, []);
  expect(s.bounds).not.toHaveBeenCalled();
});
test('status envelope pads shake and clips viewport-local coordinates without emitting swipe or particles', () => {
  const s = setup();
  const layout = s.qualify();
  expect(layout?.rects.find((r) => r.id === 'player-status')).toMatchObject({
    left: 0,
    top: 60,
    right: 170,
    bottom: 140,
  });
  expect(layout?.rects).toHaveLength(7);
  const templates = s.root.querySelectorAll('[data-presentation-sizing]');
  expect(templates.length).toBeGreaterThan(0);
  for (const node of templates) {
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(node.hasAttribute('inert')).toBe(true);
  }
});
test('unsupported values display without rounding and returning to supported requalifies', () => {
  const s = setup();
  const first = s.qualify();
  const invalid = frame({
    snapshot: snapshot({ actors: [actor(undefined, 900, 900)] }),
  });
  expect(s.ui.prepareLayout?.(invalid)).toBeUndefined();
  s.ui.render(invalid, []);
  expect(s.root.querySelector('.nt-number')?.textContent).toContain(
    '900 / 900',
  );
  s.bounds.mockClear();
  const restored = s.qualify();
  expect(restored?.layoutRevision).toBeGreaterThan(first?.layoutRevision ?? -1);
  expect(s.bounds).toHaveBeenCalled();
});
test('font and reduced-motion changes invalidate without geometry work in callbacks', () => {
  const s = setup();
  const first = s.qualify();
  s.bounds.mockClear();
  s.media.matches = true;
  s.media.dispatchEvent(new Event('change'));
  expect(s.bounds).not.toHaveBeenCalled();
  const next = s.ui.prepareLayout?.(frame());
  expect(next?.layoutRevision).toBeGreaterThan(first?.layoutRevision ?? -1);
  s.fonts.status = 'loading';
  s.fonts.dispatchEvent(new Event('loading'));
  expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
  s.ui.dispose();
  expect(observer.nodes.size).toBe(0);
  s.bounds.mockClear();
  s.fonts.dispatchEvent(new Event('loadingdone'));
  s.media.dispatchEvent(new Event('change'));
  expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
  expect(s.bounds).not.toHaveBeenCalled();
});
test('paused shell and disconnected controls are unavailable rather than clear-screen certificates', () => {
  const s = setup();
  expect(s.qualify()).toBeDefined();
  s.root.querySelector('.nt-control')?.remove();
  expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
  s.host.render({
    revision: 2,
    phase: 'playing',
    runId: run,
    game: snapshot({ pauseReasons: ['manual'], phase: 'paused' }),
    error: null,
    viewport,
  });
  expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
});

test('all finite attack-reason pairs reuse slots and preserve exact visible text', () => {
  const s = setup();
  const layout = s.qualify();
  const reasons = [
    'not-running',
    'busy',
    'cooling-lock',
    'defeated',
    'unavailable',
  ] as const;
  s.bounds.mockClear();
  for (const first of reasons)
    for (const second of reasons) {
      const base = snapshot();
      const next = frame({
        snapshot: snapshot({
          actors: base.actors.map((a) => ({
            ...a,
            actions: {
              ...a.actions,
              punch: { allowed: false, reason: first },
              kick: { allowed: false, reason: second },
            },
          })),
        }),
      });
      expect(s.ui.prepareLayout?.(next)).toBe(layout);
      s.ui.render({ ...next, presentationLayout: layout }, []);
      for (const label of s.root.querySelectorAll('.nt-heat-label')) {
        expect(label.querySelector('[data-presentation-sizing]')).toBeNull();
        expect(label.textContent).not.toContain('undefined');
      }
    }
  expect(s.bounds).not.toHaveBeenCalled();
});

test('observed overflow invalidates and callbacks never read geometry or write DOM', () => {
  const s = setup();
  s.qualify();
  s.bounds.mockClear();
  const real = s.root.querySelector('.nt-number');
  if (!real) throw Error('Missing number');
  const before = s.root.innerHTML;
  observer.callback(
    [
      {
        target: real,
        contentRect: { width: 151, height: 90 },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );
  expect(s.bounds).not.toHaveBeenCalled();
  expect(s.root.innerHTML).toBe(before);
  expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
  expect(s.bounds).not.toHaveBeenCalled();
});

test('invalid numeric bounds and maxHP are unavailable but all raw values remain displayed', () => {
  const s = setup();
  s.qualify();
  for (const change of [
    { hp: -1 },
    { hp: Infinity },
    { maxHp: Infinity },
    { maxHp: 701 },
  ]) {
    const next = frame({
      snapshot: snapshot({ actors: [{ ...actor(), ...change }] }),
    });
    expect(s.ui.prepareLayout?.(next)).toBeUndefined();
    s.ui.render(next, []);
    expect(s.root.querySelector('.nt-number')?.textContent).toBe(
      `白 ${next.snapshot.actors[0]?.hp} / ${next.snapshot.actors[0]?.maxHp}`,
    );
  }
});

test('cached absorption anchors match legacy with live shake and reduced-motion dirty measurement', () => {
  const s = setup();
  const initial = s.qualify();
  s.ui.render({ ...frame(), presentationLayout: initial }, []);
  const target = actor().actorId;
  const event: HpChanged = {
    type: 'HpChanged',
    runId: run,
    eventId: domainEventId('cache-damage'),
    sequence: 1,
    at: gameTimeMs(0),
    actorId: target,
    maxHp: 500,
    beforeHp: 500,
    afterHp: 400,
    actualHpLost: 100,
    batchId: batchId('cache'),
    cause: {
      kind: 'vehicle',
      actorId: target,
      vehicleId: vehicleId('car'),
      launchId: launchId('cache'),
    },
    contact: {
      contactId: contactId('cache'),
      point: { x: 0, y: 0, z: 0 },
      impacts: [],
    },
  };
  const projection: Projection = {
    runId: run,
    eventId: event.eventId,
    actorId: target,
    viewportRevision: viewport.revision,
    visibility: 'visible',
    cssPoint: { x: 50, y: 300 },
  };
  const damaged = snapshot({
    revision: 2,
    actors: [actor(target, 400), ...snapshot().actors.slice(1)],
  });
  const hit = frame({ snapshot: damaged, events: [event] });
  const layout = s.ui.prepareLayout?.(hit);
  expect(
    [...s.root.querySelectorAll<HTMLElement>('.nt-hp-red')].every(
      (n) => n.hidden,
    ),
  ).toBe(true);
  s.ui.render({ ...hit, presentationLayout: layout }, [projection]);
  expect(
    s.root.querySelector<HTMLElement>('.nt-actor-content')?.style.transform,
  ).not.toBe('translateX(0px)');
  for (const reduced of [false, true]) {
    s.media.matches = reduced;
    s.media.dispatchEvent(new Event('change'));
    const later = frame({
      snapshot: {
        ...damaged,
        revision: 3,
        clocks: {
          ...damaged.clocks,
          presentationTimeMs: presentationTimeMs(250),
        },
      },
    });
    const measured = s.ui.prepareLayout?.(later);
    expect(measured).toBeDefined();
    s.bounds.mockClear();
    s.ui.render({ ...later, presentationLayout: measured }, []);
    const cached = [...s.root.querySelectorAll<HTMLElement>('.nt-particle')]
      .filter((p) => !p.hidden)
      .map((p) => p.style.transform);
    expect(cached.length).toBeGreaterThan(0);
    expect(s.bounds).not.toHaveBeenCalled();
    s.ui.render(later, []);
    const legacy = [...s.root.querySelectorAll<HTMLElement>('.nt-particle')]
      .filter((p) => !p.hidden)
      .map((p) => p.style.transform);
    expect(cached).toHaveLength(legacy.length);
    cached.forEach((value, index) => {
      const actual = value.match(/[-.\d]+/g)?.map(Number);
      const expected = legacy[index]?.match(/[-.\d]+/g)?.map(Number);
      expect(actual).toHaveLength(2);
      actual?.forEach((coordinate, axis) => {
        expect(coordinate).toBeCloseTo(expected?.[axis] ?? NaN, 12);
      });
    });
  }
});

test('supported unchanged prepare and render use no alternate geometry or computed-style access', () => {
  const s = setup();
  const layout = s.qualify();
  s.bounds.mockClear();
  const style = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
    throw Error('computed style read');
  });
  for (const name of [
    'clientWidth',
    'clientHeight',
    'scrollWidth',
    'scrollHeight',
  ] as const) {
    vi.spyOn(Element.prototype, name, 'get').mockImplementation(() => {
      throw Error(`${name} read`);
    });
  }
  expect(s.ui.prepareLayout?.(frame())).toBe(layout);
  s.ui.render({ ...frame(), presentationLayout: layout }, []);
  expect(s.bounds).not.toHaveBeenCalled();
  expect(style).not.toHaveBeenCalled();
});

test('full-screen fade and results invalidate a prior clear layout', () => {
  const s = setup();
  expect(s.qualify()).toBeDefined();
  const faded = frame({
    snapshot: snapshot({
      presentation: {
        kind: 'fade',
        actorId: null,
        startedAt: presentationTimeMs(0),
        endsAt: presentationTimeMs(500),
      },
    }),
  });
  expect(s.ui.prepareLayout?.(faded)).toBeUndefined();
  expect(
    s.ui.prepareLayout?.(
      frame({ snapshot: snapshot({ presentation: { kind: 'results' } }) }),
    ),
  ).toBeUndefined();
});

test.each([44, 48, 64, 80])(
  'fixed %ipx control text scaling invalidates using real label and glyph observer nodes',
  (size) => {
    const s = setup(size);
    s.ui.prepareLayout?.(frame());
    const control = s.root.querySelector<HTMLElement>('.nt-control');
    const label = control?.querySelector<HTMLElement>('.nt-button-label');
    const glyphs = control?.querySelector<HTMLElement>('.nt-button-glyphs');
    expect(label).not.toBeNull();
    expect(glyphs).not.toBeNull();
    if (!control || !label || !glyphs)
      throw Error('Missing measured control text structure');
    expect(control.textContent).toBe('パンチ');
    expect(glyphs.getAttribute('aria-hidden')).toBe('true');
    expect(glyphs.hasAttribute('inert')).toBe(true);
    expect(
      [...glyphs.children].map((node) => node.getAttribute('data-glyph')),
    ).toEqual(['パ', 'ン', 'チ']);
    const content = size - 10;
    const deliver = (overflow: 'none' | 'height' | 'width') => {
      observer.callback(
        [...observer.nodes].map((target) => {
          let width = 150,
            height = 80;
          if (target === control) {
            width = content;
            height = content;
          }
          if (target === label) {
            width = content;
            height = overflow === 'height' ? content + 50 : 18;
          }
          if (target === glyphs) {
            width = overflow === 'width' ? content + 8 : 14;
            height = 42;
          }
          return {
            target,
            contentRect: { width, height },
          } as ResizeObserverEntry;
        }),
        {} as ResizeObserver,
      );
    };
    deliver('none');
    const first = s.ui.prepareLayout?.(frame());
    expect(first).toBeDefined();
    const fixedWidth = control.style.width,
      fixedHeight = control.style.height;
    const staleCallback = observer.callback;
    const staleEntries = [...observer.nodes].map(
      (target) =>
        ({
          target,
          contentRect: { width: 150, height: 80 },
        }) as ResizeObserverEntry,
    );
    control.style.setProperty('font-size', '72px', 'important');
    s.bounds.mockClear();
    expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
    staleCallback(staleEntries, {} as ResizeObserver);
    expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
    deliver('height');
    expect(s.bounds).not.toHaveBeenCalled();
    expect(control.style.width).toBe(fixedWidth);
    expect(control.style.height).toBe(fixedHeight);
    expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
    expect(s.bounds).not.toHaveBeenCalled();
    deliver('width');
    expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
    expect(s.bounds).not.toHaveBeenCalled();
    control.style.removeProperty('font-size');
    expect(s.ui.prepareLayout?.(frame())).toBeUndefined();
    deliver('none');
    const restored = s.ui.prepareLayout?.(frame());
    expect(restored).toBeDefined();
    expect(restored?.layoutRevision).toBeGreaterThan(
      first?.layoutRevision ?? -1,
    );
    expect(s.bounds.mock.calls.length).toBeLessThanOrEqual(10);
    s.bounds.mockClear();
    expect(s.ui.prepareLayout?.(frame())).toBe(restored);
    expect(s.bounds).not.toHaveBeenCalled();
  },
);

test('zero HP and maximum HP retain the stated supported boundary', () => {
  const s = setup();
  const zero = frame({
    snapshot: snapshot({ actors: [actor(undefined, 0, 0)] }),
  });
  expect(s.qualify(zero)).toBeDefined();
  expect(s.root.querySelector('.nt-number')?.textContent).toBe('白 0 / 0');
});

test('resized actual control rectangles reach presentation exclusion capture', () => {
  const s = setup();
  let current = viewport;
  const originalBounds = s.bounds.getMockImplementation();
  s.bounds.mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('nt-control')) {
      if (!originalBounds) throw Error('Missing bounds double');
      return originalBounds.call(this);
    }
    const width = parseFloat(this.style.width),
      height = parseFloat(this.style.height);
    const left = parseFloat(this.style.left) + current.offsetLeftCssPx;
    const top = parseFloat(this.style.top) + current.offsetTopCssPx;
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    };
  });
  const first = s.qualify(frame({ viewport: current }));
  const punch = first?.rects.find((r) => r.id === 'punch');
  expect(punch).toBeDefined();
  expect((punch?.right ?? 0) - (punch?.left ?? 0)).toBe(80);
  const jump = first?.rects.find((r) => r.id === 'jump');
  expect((jump?.right ?? 0) - (jump?.left ?? 0)).toBe(48);
  let prior = first;
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
    s.rotate(current);
    expect(s.ui.prepareLayout?.(frame({ viewport: current }))).toBeUndefined();
    const next = s.qualify(frame({ viewport: current }));
    expect(next).toBeDefined();
    expect(next?.layoutRevision).toBeGreaterThan(prior?.layoutRevision ?? -1);
    expect(next?.viewportRevision).toBe(current.revision);
    const controls = [...s.root.querySelectorAll<HTMLElement>('.nt-control')];
    for (const [index, id] of ['punch', 'kick', 'jump'].entries()) {
      const node = controls[index];
      if (!node) throw Error('Missing control');
      expect(next?.rects.find((r) => r.id === id)).toMatchObject({
        left: parseFloat(node.style.left),
        top: parseFloat(node.style.top),
        right: parseFloat(node.style.left) + parseFloat(node.style.width),
        bottom: parseFloat(node.style.top) + parseFloat(node.style.height),
      });
    }
    prior = next;
  }
  s.fonts.status = 'loading';
  s.fonts.dispatchEvent(new Event('loading'));
  expect(s.ui.prepareLayout?.(frame({ viewport: current }))).toBeUndefined();
  s.fonts.status = 'loaded';
  s.fonts.dispatchEvent(new Event('loadingdone'));
  expect(s.ui.prepareLayout?.(frame({ viewport: current }))).toBeUndefined();
  const afterFont = s.qualify(frame({ viewport: current }));
  expect(afterFont?.layoutRevision).toBeGreaterThan(
    prior?.layoutRevision ?? -1,
  );
  s.bounds.mockClear();
  expect(s.ui.prepareLayout?.(frame({ viewport: current }))).toBe(afterFont);
  expect(s.bounds).not.toHaveBeenCalled();
});

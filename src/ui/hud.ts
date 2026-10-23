import type {
  ActorId,
  UiModuleContext,
  UiPort,
  CommittedFrame,
  ViewportSnapshot,
  PresentationExclusionId,
  PresentationLayout,
  PresentationExclusionRect,
} from '../contracts';
import type { ControlElements } from '../input';
import { createDamageTimeline } from './damageTimeline';
import { element } from './elements';
import { buttonNames } from './settings';
import {
  actorSummary,
  actionLabels,
  reasonLabels,
  hudActors,
} from './viewModel';
interface HudElements {
  readonly hud: HTMLElement;
  readonly effects: HTMLElement;
  readonly fade: HTMLElement;
  readonly controls: ControlElements;
  readonly presentationElements?: (viewport: ViewportSnapshot) =>
    | {
        runId: unknown;
        key: string;
        typographyKey: string;
        textNodes: {
          node: HTMLElement;
          label: HTMLElement;
          glyphs: HTMLElement;
        }[];
        nodes: { id: PresentationExclusionId; node: HTMLElement }[];
      }
    | undefined;
}
export function createHud(
  context: UiModuleContext,
  elements: HudElements,
): UiPort {
  const document = elements.hud.ownerDocument;
  const timeline = createDamageTimeline(context.runId);
  let disposed = false;
  let revision = -1;
  const bars = new Map<
    ActorId,
    {
      root: HTMLElement;
      content: HTMLElement;
      numberSize: HTMLElement;
      heatSize: HTMLElement;
      shake: number;
      number: HTMLElement;
      bar: HTMLElement;
      green: HTMLElement;
      red: HTMLElement[];
      heat: HTMLElement;
      heatLabel: HTMLElement;
    }
  >();
  const particles = Array.from({ length: 64 }, () => {
    const node = element(document, 'span', 'nt-particle');
    node.hidden = true;
    elements.effects.append(node);
    return node;
  });
  let dirty = true;
  let cache: PresentationLayout | undefined;
  let cacheKey = '';
  let layoutRevision = 0;
  let preparedRevision = -1;
  const anchors = new Map<ActorId, { x: number; y: number }>();
  const observedShell = new Set<Element>();
  const sizes = new Map<Element, { width: number; height: number }>();
  const invalidate = () => {
    if (!disposed) dirty = true;
  };
  let typographyKey = '';
  let typographyDirty = false;
  let observerGeneration = 0;
  const invalidateTypography = () => {
    if (!disposed) {
      dirty = true;
      typographyDirty = true;
    }
  };
  const createObserver = () => {
    const generation = ++observerGeneration;
    return typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver((entries) => {
          if (disposed || generation !== observerGeneration) return;
          for (const { target, contentRect } of entries) {
            const prior = sizes.get(target);
            const next = {
              width: contentRect.width,
              height: contentRect.height,
            };
            sizes.set(target, next);
            if (
              !prior ||
              prior.width !== next.width ||
              prior.height !== next.height
            )
              dirty = true;
          }
        });
  };
  let observer = createObserver();
  const media = document.defaultView?.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  media?.addEventListener?.('change', invalidate);
  const fonts = document.fonts;
  fonts?.addEventListener('loading', invalidateTypography);
  fonts?.addEventListener('loadingdone', invalidateTypography);
  fonts?.addEventListener('loadingerror', invalidateTypography);
  const sizing = (className: string) => {
    const node = element(document, 'div', className);
    node.dataset.presentationSizing = '';
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('inert', '');
    return node;
  };
  const synchronize = (frame: CommittedFrame) => {
    const current = hudActors(frame.snapshot);
    for (const [id, bar] of bars)
      if (!current.some((a) => a.actorId === id)) {
        for (const node of [
          bar.root,
          bar.number,
          bar.numberSize,
          bar.heatLabel,
          bar.heatSize,
        ]) {
          observer?.unobserve(node);
          sizes.delete(node);
        }
        bar.root.remove();
        dirty = true;
        bars.delete(id);
      }
    for (const actor of current) {
      let bar = bars.get(actor.actorId);
      if (!bar) {
        const root = element(document, 'section', 'nt-actor');
        const player = actor.color === 'white';
        root.dataset.hudSide = player ? 'player' : 'enemy';
        root.style.gridColumn = player ? '1' : '2';
        root.style.gridRow = '1';
        root.setAttribute(
          'aria-label',
          actor.color === 'white' ? 'プレイヤー' : '現在の敵',
        );
        const content = element(document, 'div', 'nt-actor-content');
        const number = element(document, 'div', 'nt-number');
        const numberSize = sizing('nt-number-sizing');
        const heatSize = sizing('nt-heat-sizing');
        const track = element(document, 'div', 'nt-hp');
        track.setAttribute('role', 'meter');
        track.setAttribute(
          'aria-label',
          `${actor.color === 'white' ? 'プレイヤー' : '敵'} HP`,
        );
        const green = element(document, 'div', 'nt-hp-green');
        const red = Array.from({ length: 16 }, () =>
          element(document, 'div', 'nt-hp-red'),
        );
        track.append(...red, green);
        const heat = element(document, 'div', 'nt-heat');
        const heatLabel = element(document, 'div', 'nt-heat-label');
        content.append(numberSize, number, track, heat, heatSize, heatLabel);
        root.append(content);
        elements.hud.append(root);
        bar = {
          root,
          content,
          numberSize,
          heatSize,
          shake: 0,
          number,
          bar: track,
          green,
          red,
          heat,
          heatLabel,
        };
        for (const node of [root, number, numberSize, heatLabel, heatSize])
          observer?.observe(node);
        dirty = true;
        bars.set(actor.actorId, bar);
      }
      const color = {
        white: '白',
        blue: '青',
        green: '緑',
        yellow: '黄',
        black: '黒',
      }[actor.color];
      const setParts = (target: HTMLElement, values: string[]) => {
        if (target.dataset.value === JSON.stringify(values)) return;
        target.dataset.value = JSON.stringify(values);
        target.replaceChildren(
          ...values.map((value) => element(document, 'span', '', value)),
        );
      };
      setParts(bar.number, [`${color} ${actor.hp}`, ` / ${actor.maxHp}`]);
      setParts(bar.numberSize, [
        `${color} ${'8'.repeat(24)}`,
        ` / ${'8'.repeat(24)}`,
      ]);
      const summary = actorSummary(actor, frame.snapshot.clocks);
      const reasons = [
        ...new Set(
          [actor.actions.punch, actor.actions.kick].flatMap((p) =>
            p.allowed ? [] : [reasonLabels[p.reason]],
          ),
        ),
      ];
      setParts(bar.heatLabel, [
        `熱量 ${summary.heatText}`,
        reasons.length ? ` · ${reasons.join(' / ')}` : '',
        summary.cooldownSeconds > 0
          ? ` · ${summary.cooldownSeconds.toFixed(1)}秒`
          : '',
      ]);
      if (!bar.heatSize.children.length) {
        const variants = element(document, 'span', 'nt-sizing-variants');
        const labels = Object.values(reasonLabels);
        for (const first of labels) {
          variants.append(element(document, 'span', '', ` · ${first}`));
          for (const second of labels)
            variants.append(
              element(document, 'span', '', ` · ${first} / ${second}`),
            );
        }
        bar.heatSize.append(
          element(document, 'span', '', '熱量 7.0 / 7'),
          variants,
          element(document, 'span', '', ' · 3.0秒'),
        );
      }
    }
    return current;
  };
  const unavailable = () => {
    cache = undefined;
    anchors.clear();
    dirty = true;
    preparedRevision = -1;
    return undefined;
  };
  const prepareLayout = (
    frame: CommittedFrame,
  ): PresentationLayout | undefined => {
    if (
      disposed ||
      frame.snapshot.runId !== context.runId ||
      frame.snapshot.revision < revision
    )
      return unavailable();
    if (
      frame.snapshot.presentation.kind === 'fade' ||
      frame.snapshot.presentation.kind === 'results' ||
      frame.snapshot.pauseReasons.length ||
      ['loading', 'ready', 'paused', 'stopped', 'error'].includes(
        frame.snapshot.phase,
      )
    )
      return unavailable();
    const current = synchronize(frame);
    const shell = elements.presentationElements?.(frame.viewport);
    if (
      !shell ||
      shell.runId !== context.runId ||
      !observer ||
      !fonts ||
      fonts.status !== 'loaded'
    )
      return unavailable();
    const supported = current.every((actor) => {
      const cooldown = actorSummary(
        actor,
        frame.snapshot.clocks,
      ).cooldownSeconds;
      return (
        Number.isFinite(actor.hp) &&
        Number.isFinite(actor.maxHp) &&
        actor.hp >= 0 &&
        actor.hp <= actor.maxHp &&
        actor.maxHp >= 0 &&
        actor.maxHp <= 700 &&
        String(actor.hp).length <= 24 &&
        String(actor.maxHp).length <= 24 &&
        Number.isFinite(actor.heat.amount) &&
        actor.heat.amount >= 0 &&
        actor.heat.amount <= 7 &&
        actor.heat.capacity === 7 &&
        (actor.heat.lockedUntil === null ||
          Number.isFinite(actor.heat.lockedUntil)) &&
        Number.isFinite(cooldown) &&
        cooldown >= 0 &&
        cooldown <= 3 &&
        [actor.actions.punch, actor.actions.kick].every(
          (p) => p.allowed || Object.hasOwn(reasonLabels, p.reason),
        )
      );
    });
    if (!supported || current.length > 2) return unavailable();
    if (
      shell.nodes.some(({ node }) => !node.isConnected || node.hidden) ||
      current.some((actor) => {
        const bar = bars.get(actor.actorId);
        return !bar?.root.isConnected || bar.root.hidden;
      })
    )
      return unavailable();
    if (
      typographyDirty ||
      (typographyKey && typographyKey !== shell.typographyKey)
    ) {
      observer.disconnect();
      observer = createObserver();
      sizes.clear();
      observedShell.clear();
      dirty = true;
      for (const bar of bars.values())
        for (const node of [
          bar.root,
          bar.number,
          bar.numberSize,
          bar.heatLabel,
          bar.heatSize,
        ])
          observer?.observe(node);
      typographyDirty = false;
    }
    typographyKey = shell.typographyKey;
    if (!observer) return unavailable();
    const shellTargets = [
      ...shell.nodes.map(({ node }) => node),
      ...shell.textNodes.flatMap(({ label, glyphs }) => [label, glyphs]),
    ];
    for (const node of shellTargets)
      if (!observedShell.has(node)) {
        observer.observe(node);
        observedShell.add(node);
      }
    for (const node of observedShell)
      if (!shellTargets.includes(node as HTMLElement)) {
        observer.unobserve(node);
        observedShell.delete(node);
        sizes.delete(node);
      }
    // Whole-label natural height and maximum individual glyph width must fit the
    // actual content box. Border rectangles alone cannot qualify scaled text.
    for (const { node, label, glyphs } of shell.textNodes) {
      const box = sizes.get(node),
        text = sizes.get(label),
        glyph = sizes.get(glyphs);
      if (
        !label.isConnected ||
        !glyphs.isConnected ||
        !box ||
        !text ||
        !glyph ||
        ![
          box.width,
          box.height,
          text.width,
          text.height,
          glyph.width,
          glyph.height,
        ].every((value) => Number.isFinite(value) && value > 0) ||
        text.width > box.width ||
        text.height > box.height ||
        glyph.width > box.width
      )
        return unavailable();
    }
    const key = JSON.stringify([
      shell.key,
      current.map((a) => [a.actorId, a.color]),
      media?.matches ?? false,
    ]);
    if (cache && !dirty && cacheKey === key) {
      preparedRevision = frame.snapshot.revision;
      return cache;
    }
    const nodes = [...shell.nodes];
    for (const actor of current) {
      const bar = bars.get(actor.actorId);
      if (!bar) return unavailable();
      for (const node of [
        bar.root,
        bar.number,
        bar.numberSize,
        bar.heatLabel,
        bar.heatSize,
      ]) {
        const size = sizes.get(node);
        if (
          !size ||
          !Number.isFinite(size.width) ||
          !Number.isFinite(size.height) ||
          size.width <= 0 ||
          size.height <= 0
        )
          return unavailable();
      }
      for (const [real, template] of [
        [bar.number, bar.numberSize],
        [bar.heatLabel, bar.heatSize],
      ] as const) {
        const actual = sizes.get(real);
        const reserved = sizes.get(template);
        if (!actual || !reserved) return unavailable();
        if (actual.width > reserved.width || actual.height > reserved.height)
          return unavailable();
      }
      nodes.push({
        id: actor.color === 'white' ? 'player-status' : 'opponent-status',
        node: bar.root,
      });
    }
    if (
      nodes.length > 8 ||
      new Set(nodes.map((n) => n.id)).size !== nodes.length ||
      nodes.some(({ node }) => !node.isConnected || node.hidden)
    )
      return unavailable();
    const v = frame.viewport;
    const rects: PresentationExclusionRect[] = [];
    const nextAnchors = new Map<ActorId, { x: number; y: number }>();
    for (const { id, node } of nodes) {
      const rect = node.getBoundingClientRect();
      const pad = id.endsWith('-status') ? 12 : 0;
      if (
        ![
          rect.left,
          rect.top,
          rect.right,
          rect.bottom,
          rect.width,
          rect.height,
        ].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return unavailable();
      const measured = {
        id,
        left: Math.max(0, rect.left - v.offsetLeftCssPx - pad),
        top: Math.max(0, rect.top - v.offsetTopCssPx),
        right: Math.min(v.widthCssPx, rect.right - v.offsetLeftCssPx + pad),
        bottom: Math.min(v.heightCssPx, rect.bottom - v.offsetTopCssPx),
      };
      if (measured.right <= measured.left || measured.bottom <= measured.top)
        return unavailable();
      rects.push(Object.freeze(measured));
    }
    for (const actor of current) {
      const bar = bars.get(actor.actorId);
      if (!bar) return unavailable();
      const rect = bar.bar.getBoundingClientRect();
      const x =
        rect.left -
        v.offsetLeftCssPx +
        rect.width / 2 -
        (media?.matches ? 0 : bar.shake);
      const y = rect.top - v.offsetTopCssPx + rect.height / 2;
      if (
        ![x, y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return unavailable();
      nextAnchors.set(actor.actorId, { x, y });
    }
    anchors.clear();
    for (const [id, value] of nextAnchors) anchors.set(id, value);
    cache = Object.freeze({
      runId: context.runId,
      viewportRevision: v.revision,
      layoutRevision: ++layoutRevision,
      rects: Object.freeze(rects),
    });
    cacheKey = key;
    dirty = false;
    preparedRevision = frame.snapshot.revision;
    return cache;
  };
  return {
    prepareLayout,
    render(frame, projections) {
      if (
        disposed ||
        frame.snapshot.runId !== context.runId ||
        frame.snapshot.revision < revision
      )
        return;
      revision = frame.snapshot.revision;
      const viewportMatches =
        context.viewport.read().revision === frame.viewport.revision;
      timeline.update(frame, viewportMatches ? projections : []);
      let particleIndex = 0;
      const current = synchronize(frame);
      for (const actor of current) {
        const bar = bars.get(actor.actorId);
        if (!bar) continue;
        const view = timeline.read(actor.actorId);
        if (!view) continue;

        bar.bar.setAttribute('aria-valuenow', String(view.hp));
        bar.bar.setAttribute('aria-valuemin', '0');
        bar.bar.setAttribute('aria-valuemax', String(view.maxHp));
        bar.green.style.width = `${view.greenRatio * 100}%`;
        const reduced =
          document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
            .matches ?? false;
        bar.shake = reduced ? 0 : view.shakePx;
        bar.content.style.transform = reduced
          ? 'none'
          : `translateX(${view.shakePx}px)`;
        bar.red.forEach((node, index) => {
          const loss = view.losses[index];
          node.hidden = !loss;
          if (loss) {
            node.style.left = `${loss.low * 100}%`;
            node.style.width = `${Math.max(0, loss.high - loss.low) * 100}%`;
          }
        });
        const summary = actorSummary(actor, frame.snapshot.clocks);
        bar.heat.style.width = `${summary.heatRatio * 100}%`;
        if (actor.color === 'white')
          for (const name of buttonNames) {
            const permission = actor.actions[name];
            elements.controls[name].setAttribute(
              'aria-disabled',
              String(!permission.allowed),
            );
            elements.controls[name].setAttribute(
              'aria-label',
              `${actionLabels[name]}${permission.allowed ? '' : `：${reasonLabels[permission.reason]}`}`,
            );
          }
        const cachedAnchor =
          cache &&
          !dirty &&
          preparedRevision === frame.snapshot.revision &&
          cache.viewportRevision === frame.viewport.revision &&
          frame.presentationLayout?.layoutRevision === cache.layoutRevision
            ? anchors.get(actor.actorId)
            : undefined;
        let anchor = { x: NaN, y: NaN };
        let measurable = false;
        if (cachedAnchor) {
          anchor = { x: cachedAnchor.x + bar.shake, y: cachedAnchor.y };
          measurable = true;
        } else {
          const rect = bar.bar.getBoundingClientRect();
          anchor = {
            x: rect.left - frame.viewport.offsetLeftCssPx + rect.width / 2,
            y: rect.top - frame.viewport.offsetTopCssPx + rect.height / 2,
          };
          measurable = rect.width > 0 && rect.height > 0;
        }
        const anchorValid =
          viewportMatches &&
          measurable &&
          Number.isFinite(anchor.x) &&
          Number.isFinite(anchor.y) &&
          anchor.x >= 0 &&
          anchor.y >= 0 &&
          anchor.x <= frame.viewport.widthCssPx &&
          anchor.y <= frame.viewport.heightCssPx;
        for (const loss of view.losses) {
          if (!loss.origin || !anchorValid || loss.phase === 'shrinking')
            continue;
          const lossRatio = Math.max(0, loss.high - loss.low);
          const amount = reduced
            ? 1
            : Math.min(
                frame.snapshot.quality === 'low' ? 3 : 8,
                Math.ceil(2 + lossRatio * 24),
              );
          for (let i = 0; i < amount && particleIndex < particles.length; i++) {
            const particle = particles[particleIndex++];
            if (!particle) continue;
            const progress =
              loss.phase === 'red'
                ? 0
                : Math.min(1, (loss.progress - 0.12) / 0.46);
            const spread = (1 - progress) * (reduced ? 0 : 12);
            const angle = (i / amount) * Math.PI * 2;
            const x =
              loss.origin.x +
              (anchor.x - loss.origin.x) * progress +
              Math.cos(angle) * spread;
            const y =
              loss.origin.y +
              (anchor.y - loss.origin.y) * progress +
              Math.sin(angle) * spread -
              Math.sin(progress * Math.PI) * (reduced ? 0 : 40);
            particle.hidden = false;
            const size = Math.min(10, 4 + lossRatio * 12);
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.transform = `translate(${x}px,${y}px)`;
            particle.style.opacity = String(1 - progress * 0.4);
          }
        }
      }
      for (const particle of particles.slice(particleIndex))
        particle.hidden = true;
      const stage = frame.snapshot.presentation;
      elements.fade.hidden = stage.kind !== 'fade';
      if (stage.kind === 'fade')
        elements.fade.style.opacity = String(
          Math.max(
            0,
            Math.min(
              1,
              (frame.snapshot.clocks.presentationTimeMs - stage.startedAt) /
                Math.max(1, stage.endsAt - stage.startedAt),
            ),
          ),
        );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      sizes.clear();
      anchors.clear();
      cache = undefined;
      media?.removeEventListener?.('change', invalidate);
      fonts?.removeEventListener('loading', invalidateTypography);
      fonts?.removeEventListener('loadingdone', invalidateTypography);
      fonts?.removeEventListener('loadingerror', invalidateTypography);
      timeline.clear();
      for (const bar of bars.values()) bar.root.remove();
      bars.clear();
      for (const particle of particles) particle.remove();
      elements.fade.hidden = true;
    },
  };
}

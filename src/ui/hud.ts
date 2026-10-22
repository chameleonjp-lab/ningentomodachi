import type { ActorId, UiModuleContext, UiPort } from '../contracts';
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
  return {
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
      const current = hudActors(frame.snapshot);
      for (const [id, bar] of bars)
        if (!current.some((a) => a.actorId === id)) {
          bar.root.remove();
          bars.delete(id);
        }
      for (const actor of current) {
        let bar = bars.get(actor.actorId);
        if (!bar) {
          const root = element(document, 'section', 'nt-actor');
          root.setAttribute(
            'aria-label',
            actor.color === 'white' ? 'プレイヤー' : '現在の敵',
          );
          const number = element(document, 'div', 'nt-number');
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
          root.append(number, track, heat, heatLabel);
          elements.hud.append(root);
          bar = { root, number, bar: track, green, red, heat, heatLabel };
          bars.set(actor.actorId, bar);
        }
        const view = timeline.read(actor.actorId);
        if (!view) continue;
        bar.number.textContent = `${actor.color === 'white' ? '白' : { blue: '青', green: '緑', yellow: '黄', black: '黒', white: '白' }[actor.color]} ${view.hp} / ${view.maxHp}`;
        bar.bar.setAttribute('aria-valuenow', String(view.hp));
        bar.bar.setAttribute('aria-valuemin', '0');
        bar.bar.setAttribute('aria-valuemax', String(view.maxHp));
        bar.green.style.width = `${view.greenRatio * 100}%`;
        const reduced =
          document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
            .matches ?? false;
        bar.root.style.transform = reduced
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
        const reasons = [
          ...new Set(
            [actor.actions.punch, actor.actions.kick].flatMap((p) =>
              p.allowed ? [] : [reasonLabels[p.reason]],
            ),
          ),
        ];
        bar.heatLabel.textContent = `熱量 ${summary.heatText}${reasons.length ? ` · ${reasons.join(' / ')}` : ''}${summary.cooldownSeconds > 0 ? ` · ${summary.cooldownSeconds.toFixed(1)}秒` : ''}`;
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
        const rect = bar.bar.getBoundingClientRect();
        const anchor = {
          x: rect.left - frame.viewport.offsetLeftCssPx + rect.width / 2,
          y: rect.top - frame.viewport.offsetTopCssPx + rect.height / 2,
        };
        const anchorValid =
          viewportMatches &&
          rect.width > 0 &&
          rect.height > 0 &&
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
      timeline.clear();
      for (const bar of bars.values()) bar.root.remove();
      bars.clear();
      for (const particle of particles) particle.remove();
      elements.fade.hidden = true;
    },
  };
}

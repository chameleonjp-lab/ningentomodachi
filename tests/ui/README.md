# P1 D interface evidence and integration boundary

`createInterface(positionedRoot, { storage? })` exports `host`, `ui`, and `input` factories for A's public `ModuleFactories`. Root dimensions, offsets, safe areas and revisions come only from A's `ViewportReader`. Use the same positioned root for C's render surface and D's overlay. The host factory is called once and survives run errors/retry/disposal. UI and input factories are per run. D does not create Core, a renderer, frame loop or wall-time timer.

## Independent tests

Run `npm test -- tests/input tests/ui`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Default test environment remains Node; DOM tests opt into jsdom per file. Public synthetic Core snapshots/events/projections are in `fixtures/core.ts` and test builders. No actual B/C game asset, scene hit or P1 battle implementation is needed or claimed.
- Settings: JSON/schema/storage denial, safe areas/rotation/minimum 44 CSS px, overlap fallback, actual resolved persistence, live settings preview.
- Host: title/readiness/error/retry, loading without fabricated percentage, run disposal survival, settings reason isolation, error interrupting settings, Core-quality display.
- HUD: black 700 denominator, zero/clamped lethal damage, green/red/absorption/shrink progression, multiple losses/heal/dedup, stale run/opponent/snapshot/viewport, deadline truncation, frozen presentation time, bounded effects.
- DOM: real event listener attachment/removal, authoritative permission labels, synthetic DOM rects validating correct damaged bar and root-offset CSS projection, no device-pixel scaling, stale DOM viewport skips flight but not HP/red.
- Result: supplied metrics, victory/defeat, unmet clear time, signed authoritative contributions and rounding/clamp adjustment. No D scoring formula.

## Honest limits and device checks still required

No browser screenshot, real WebKit rendering, physical touch/VoiceOver, actual scene-contact projection or device performance has been verified. jsdom does not lay out/render CSS; synthetic rect tests prove coordinate consumption, not pixel quality. The default app build still builds A's P0 entry, not an integrated full game. D5+ live integration remains gated on A/B/C/root.

Primary: iPhone 17 Pro Safari. Auxiliary: iPhone 11 Pro and iPad Pro 2018, including low quality. For each: portrait/landscape, safe-area offsets and browser-toolbar change; 200% text zoom; screen reader navigation/activation; 3+ simultaneous pointers; swipe + jump + attack; long press, pointer cancellation and app switch; controls never stranded after resume; settings slider preview and persistence denial; black/white correct particle destination; rapid loss/heal/opponent switch; terminal 1.5/2-second authority deadlines; repeated retry/disposal; particle budget and sustained FPS. OS edge gestures cannot be fully suppressed. Report actual device/browser versions and measured FPS separately from desktop emulation.

Styles are scoped to `.nt-interface`. Gameplay surfaces suppress touch scroll/selection/context menu; unrelated page interaction is untouched. Settings/results scroll normally. Controls preserve keyboard/assistive click activation and accessible names. Reduced-motion uses fewer particles and disables HUD shake; low-quality reduces particles without changing red-loss or HP meaning. These are implementation choices, not a claim of accessibility or device acceptance.

# D5–D6 local public-Core integration evidence

`core-integration.test.ts` composes the actual public `createCore`, A's public `createGame`, and D's `createInterface`. Its per-file environment is jsdom. `fixtures/integration.ts` is explicitly test-only: a complete synthetic 12-punch/19-kick catalog, metadata-only source readiness/failure, scripted enemy intent provider, synthetic scene contacts tied to actual Core activation/impact IDs, synthetic viewport/projection, and synthetic DOM rectangles. Core, not fixtures or UI, calculates every HP loss, heal, heat, transition, and score. This does not validate B assets, real C geometry, enemy AI, or production composition.

Twelve actual-Core scenarios cover:
1. Persistent title → loading → ready → start, D pointers → A tick batch → actual Core acceptance, actual 150 HP loss → green/red/particles. Enemy-bar absorption uses its synthetic DOM anchor (250 root CSS pixels rather than player 50), not DPR or a falling presentation transform. Completing a particle never changes HP.
2. Held-basis movement across fixture basis revision change; competing jump/attack Core arbitration; pending input cancellation on settings pause; background/interruption reasons survive closing settings.
3. Source preparation failure → retry → ready; return-to-title → new run; stale held pointers cannot leak.
4. Real player damage followed by enemy defeat and authoritative 100 HP heal clears previous player red history while retaining the defeated enemy HP0, capped lethal red interval and correct enemy-anchor absorption through the presentation. Authoritative deadline/replacement removes the old victim.
5. Four enemy strikes cause actual player defeat, clamped lethal HP loss, frozen result, authoritative slow/fade deadline, displayed defeat/rounding adjustment, retry reset.
6. Shared landscape viewport update releases a held movement session; offscreen damage updates HP/red without fabricated flight.
7. Pointer cancel clears three simultaneous pointers and queued commands before the next Core tick.
8. Seven real attacks reach heat capacity, authoritative permissions gate controls; settings pause freezes clocks; Core unlock eventually updates HUD without wall timers.
9. Four real encounters reach clear; black retains its 700 maximum, HP0, capped 100/700 lethal red interval and enemy-anchor absorption until authoritative cleanup. All supplied score contribution rows render unchanged, including destruction and adjustment (zero destruction in this geometry-free fixture).
10. Return to title during defeat disposes the retained victim and effects; a new run starts clean. Skipped presentation frames cannot replay expired loss. Two additional selector unit cases cover exact deadline and replacement even when no intermediate presentation frame arrives.

11–12. Simultaneous lethal blue and final black retain both authoritative zero-HP bars and capped losses during player defeat, with particles converging to separate synthetic player/enemy anchors. No heal or victory conversion occurs; final black still yields defeat with four defeated enemies and unmet clear time. Deadline/fade/results and retry remove the old effects. A selector unit case covers exact expiry, skipped frames and replacement for these participants.

Run `npm test -- tests/ui/core-integration.test.ts`. Existing independent D input/UI tests remain applicable. No production bootstrap, package/config/contract change, or source asset was introduced by D. Following independent review, the bounded D production correction shares a display-only actor selector between HUD and damage timeline and preserves OpponentChanged loss history only for that retained presentation victim. The combat target, HP, score and clocks are not changed.

## Limits

These are state/DOM assertions, not browser layout or accessibility acceptance. CSS rendering, Safari, physical multitouch, VoiceOver, 200% text zoom, landscape clipping/safe areas, visual particle quality and FPS remain unverified. Existing browser execution blockers were not retried. The future permitted render/device harness must measure those separately. Actual A/B/C production integration remains owned/coordinated by A/root.

Initial fixture failures were corrected in test-only files. The first healing test did not actually assert its claimed enemy-loss preservation. Independent real-Core review then reproduced the disappearing defeated-enemy HUD; the strengthened test failed with one bar instead of two before the bounded production correction. Same-tick movement suppression is a separate A/Core issue and is not approved by these tests. Held-basis evidence is revision identity only, not real camera rotation. Real falling-body projection and nonzero destruction remain outside this fixture.

R2 review found a valid simultaneous-lethal regression in R1's blanket defeated-opponent exclusion. The two new real-Core regressions failed before the narrow correction. During authoritative player defeat-slow only, the still-current opponent is retained even if defeated; expiry and replacement remain bounded by A. The test-only source now supports simultaneous independent body contacts using actual Core activation/impact IDs, and scripted black attacks use kicks. No victory, healing or scoring rule changed.

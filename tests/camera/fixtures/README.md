# Actual two-resident camera input captures

These JSON-lines fixtures contain every public camera update from setup, source
motion, and the complete 121-sample death presentation. They are geometry/time
regressions, not runtime attack metadata or a synthetic production catalog.
- Source fixture: `tests/integration/fixtures/twoResidentWorld.ts`, qualified
  integration checkpoint `6e53fdd0e186e5088fbb40cc3751b90be099ea3e`.
- Camera source: accepted `ac053a5901e25acf797673fd1b04218286b5be9e`.
- Production Paris street, white plus blue resident, blue punch death, portrait
  400 by 800, original safe-area offsets and public support bounds.
- ChineseCartwheelKick enters at source time 1.04 seconds (374 updates).
- DivingLunge enters at source time 0.6611110925674438 seconds (312 updates).
- Death sample i uses clip time i/240 seconds mapped through the actual death
  slow interval, then normal time. Every original input number is retained.
- `originalPosition` is evidence of the old result, not an expected new eye.
  `args` is the public camera update argument tuple; `label` identifies death
  samples without introducing another gameplay/presentation clock.

The regression certifies an achievable alternative using actual Three frustum
math and an independent convex-distance obstruction oracle. Selection overhead
is compared against that alternative, not against an arbitrary maximum speed;
mandatory safety motion is never forbidden. Physical/source poses are unchanged.

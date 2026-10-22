import type { ModuleContext, SpatialModule } from '../../../src/contracts';
import { createFixtureRenderHost, type FixtureRenderNode } from './renderHost';
export function createFixtureSpatial(
  trace: string[],
  context: ModuleContext,
): SpatialModule<FixtureRenderNode> {
  const host = createFixtureRenderHost(context);
  return {
    renderHost: host.port,
    project: () => [],
    commit: ({ snapshot }) => ({
      runId: snapshot.runId,
      tick: snapshot.clocks.tick,
      actors: [],
      vehicles: [],
    }),
    beginMovementSession: (sessionId) => ({
      runId: context.runId,
      sessionId,
      revision: 0,
      right: { x: 1, y: 0, z: 0 },
      depth: { x: 0, y: 0, z: 1 },
    }),
    endMovementSession: () => {},
    step: ({ snapshot }) => {
      trace.push(`spatial.step:${snapshot.clocks.tick}`);
      return {
        snapshot: {
          runId: snapshot.runId,
          tick: snapshot.clocks.tick,
          actors: [],
          vehicles: [],
        },
        candidates: [],
      };
    },
    render: () => {
      trace.push('spatial.render');
    },
    dispose: () => {
      host.dispose();
      trace.push('spatial.dispose');
    },
  };
}

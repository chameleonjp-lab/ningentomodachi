import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { CoreOutput, RunId } from '../contracts';
export function createWorldImpactFx(run: RunId) {
  const root = new Group();
  root.name = 'world-effects';
  const seen = new Set<string>();
  const geometry = new SphereGeometry(1, 6, 4),
    material = new MeshBasicMaterial({ color: 0xffc66f });
  const entries: Array<{ mesh: Mesh; born: number }> = [];
  return {
    root,
    consume(output: CoreOutput) {
      for (const event of output.events) {
        if (event.runId !== run || seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        if (event.type !== 'HpChanged' && event.type !== 'ClashResolved')
          continue;
        if (event.type === 'HpChanged' && event.actualHpLost <= 0) continue;
        let entry = entries.length < 48 ? undefined : entries.shift();
        if (!entry) {
          entry = { mesh: new Mesh(geometry, material), born: 0 };
          root.add(entry.mesh);
        }
        entry.born = output.snapshot.clocks.presentationTimeMs;
        entry.mesh.position.set(
          event.contact.point.x,
          event.contact.point.y,
          event.contact.point.z,
        );
        entry.mesh.visible = true;
        entry.mesh.scale.setScalar(0.12);
        entries.push(entry);
      }
    },
    update(time: number) {
      for (const entry of entries) {
        const age = time - entry.born;
        entry.mesh.visible = age >= 0 && age < 220;
        entry.mesh.scale.setScalar(0.12 + Math.max(0, age) * 0.0007);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      entries.length = 0;
      seen.clear();
      root.clear();
    },
  };
}

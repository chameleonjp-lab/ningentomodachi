/** Optional independent visual-review evidence; exports actual displayed CPU vertices in world space. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Camera, type Object3D, SkinnedMesh, Vector3 } from 'three';

export function exportWorldPose(
  directory: string,
  name: string,
  root: Object3D,
  camera: Camera,
  metadata: object,
): void {
  const meshes: object[] = [];
  const p = new Vector3();
  root.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  root.traverse((node) => {
    if (!(node instanceof SkinnedMesh)) return;
    node.skeleton.update();
    const positions: number[] = [];
    for (let i = 0; i < node.geometry.getAttribute('position').count; i++) {
      node.getVertexPosition(i, p).applyMatrix4(node.matrixWorld);
      positions.push(p.x, p.y, p.z);
    }
    const material = Array.isArray(node.material)
      ? node.material[0]
      : node.material;
    meshes.push({
      name: node.name,
      positions,
      indices: node.geometry.index
        ? Array.from(node.geometry.index.array)
        : null,
      color: material && 'color' in material ? material.color : null,
    });
  });
  writeFileSync(
    join(directory, `${name}.json`),
    JSON.stringify({
      version: 1,
      scope:
        'Actual B CPU skinned world mesh after C settlement, actual C camera matrices; not GPU raster evidence',
      groundY: 0,
      metadata,
      camera: {
        matrixWorld: camera.matrixWorld.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
        matrixWorldInverse: camera.matrixWorldInverse.toArray(),
      },
      meshes,
    }),
    { flag: 'wx' },
  );
}

import {
  type BufferGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  type Texture,
} from 'three';
import {
  type GLTF,
  GLTFLoader,
  type GLTFLoaderPlugin,
  type GLTFParser,
} from 'three/addons/loaders/GLTFLoader.js';

/** Internal loader for already inspected, hash-pinned self-contained input. Uses
 * installed public register/beforeRoot hooks, not modified JSON or parser methods.
 * The scheduler must perform an actual task yield and check cancellation. Native
 * static loading and one original loadAnimation invocation remain atomic costs. */
export async function parseGlbYielding(
  bytes: Uint8Array,
  checkpoint: (stage: string) => Promise<void>,
): Promise<GLTF> {
  const captured = new Uint8Array(bytes);
  const scenes = new Set<Object3D>();
  const pendingStatic = new Set<Promise<unknown>>();
  const observedSkins = new Set<Skeleton>();
  const observe = <T>(pending: Promise<T>, retain: (value: T) => void) => {
    const observed = pending.then((value) => {
      retain(value);
      return value;
    });
    pendingStatic.add(observed);
    // A deliberately broken upstream aggregate may no longer consume this child.
    // Keep its rejection handled while preserving it for the later ownership drain.
    void observed.catch(() => {});
    return observed;
  };
  const loader = new GLTFLoader();
  let tail: Promise<unknown> = Promise.resolve();
  let failed = false;
  let failure: unknown;
  const checkActive = () => {
    if (failed) throw failure;
  };
  loader.register((parser) => {
    // Installed GLTFParser.getDependency('animation') invokes this plugin hook.
    // @types omits it from GLTFLoaderPlugin, but types the original loadAnimation.
    // Structural composition uses that exact type, with no private type copy.
    const plugin: GLTFLoaderPlugin & Pick<GLTFParser, 'loadAnimation'> = {
      name: 'B_YIELD_ANIMATIONS_V1',
      // Observe the supported mesh hook too: a scene aggregation can reject after
      // meshes resolve but before beforeRoot receives its scene. Never replace
      // mesh construction or bypass the parser dependency cache.
      loadMesh(index) {
        checkActive();
        return observe(parser.loadMesh(index), (mesh) => {
          scenes.add(mesh);
        });
      },
      loadNode(index) {
        // Original loadNode starts its shallow node, children and skin first.
        // Observe, do not replace, that work or its dependency-cache entries.
        const pending = observe(parser.loadNode(index), (node) => {
          scenes.add(node);
        });
        const definitions: unknown = parser.json.nodes;
        const definition: unknown = Array.isArray(definitions)
          ? definitions[index]
          : undefined;
        if (!definition || typeof definition !== 'object')
          throw new Error('Invalid loaded node');
        if ('skin' in definition && definition.skin !== undefined) {
          const skin = definition.skin;
          if (typeof skin !== 'number' || !Number.isInteger(skin) || skin < 0)
            throw new Error('Invalid loaded skin index');
          // Promise.all in loadNode may reject before its independent skin settles.
          // The original call already requested this cache entry. Retain the skin
          // directly even if no successfully returned node ever binds it.
          const cached: Promise<unknown> = parser.getDependency('skin', skin);
          observe(cached, (value) => {
            if (!(value instanceof Skeleton))
              throw new Error('Invalid loaded skin');
            observedSkins.add(value);
          });
        }
        return pending;
      },
      async beforeRoot() {
        await checkpoint('static:before');
        checkActive();
        const aggregate = parser.getDependencies('scene');
        const definitions: unknown = parser.json.scenes;
        if (!Array.isArray(definitions))
          throw new Error('Invalid scene definitions');
        for (let index = 0; index < definitions.length; index++) {
          // Normal getDependencies has already started these exact cached scenes.
          // An upstream aggregate rejection must not detach their ownership work.
          const cached: Promise<unknown> = parser.getDependency('scene', index);
          observe(cached, (value) => {
            if (!(value instanceof Object3D))
              throw new Error('Invalid loaded scene');
            scenes.add(value);
          });
        }
        const roots: unknown = await aggregate;
        if (!Array.isArray(roots)) throw new Error('Invalid loaded scenes');
        for (const root of roots) {
          if (!(root instanceof Object3D))
            throw new Error('Invalid loaded scene');
          scenes.add(root);
        }
        await Promise.all(pendingStatic);
        // Retain the actual scene BEFORE a scheduler or animation can reject.
        await checkpoint('static:after');
      },
      loadAnimation(index) {
        const next = tail.then(async () => {
          checkActive();
          await checkpoint(`animation:${index}:before`);
          checkActive();
          const clip = await parser.loadAnimation(index);
          checkActive();
          await checkpoint(`animation:${index}:after`);
          return clip;
        });
        tail = next;
        return next;
      },
      async afterRoot() {
        await checkpoint('root:ready');
      },
    };
    return plugin;
  });
  try {
    return await loader.parseAsync(captured.buffer, '');
  } catch (error) {
    // A parallel root dependency can reject while the first queued checkpoint is
    // suspended. Stop subsequent work and settle that queue BEFORE disposal.
    // Cancellation is cooperative; the supplied scheduler must itself settle.
    failure = error;
    failed = true;
    await Promise.allSettled([tail]);
    // Nodes, children, scenes and skins can settle later than their mesh or an
    // upstream Promise.all rejection. Drain the growing finite set before any
    // disposal. Sources are pinned, self-contained and have no external I/O.
    let settled = 0;
    while (settled < pendingStatic.size) {
      const pending = [...pendingStatic];
      await Promise.allSettled(pending);
      settled = pending.length;
    }
    // parseAsync has not transferred ownership to the outer pack. Shared scene
    // resources are released once even when several nodes reference them.
    const geometries = new Set<BufferGeometry>(),
      materials = new Set<Material>(),
      skeletons = new Set(observedSkins),
      textures = new Set<Texture>();
    for (const scene of scenes)
      scene.traverse((node) => {
        if (node instanceof SkinnedMesh && node.skeleton)
          skeletons.add(node.skeleton);
        if (!(node instanceof Mesh)) return;
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          materials.add(material);
          if (material instanceof MeshStandardMaterial)
            for (const texture of [
              material.map,
              material.normalMap,
              material.roughnessMap,
              material.metalnessMap,
              material.emissiveMap,
              material.aoMap,
            ])
              if (texture) textures.add(texture);
        }
      });
    for (const resource of geometries) resource.dispose();
    for (const resource of materials) resource.dispose();
    for (const resource of skeletons) resource.dispose();
    for (const resource of textures) resource.dispose();
    throw error;
  }
}

// SANDLINE map: a desert-industrial compound, 48 x 40 m. Attackers spawn south,
// defenders north. A site is the storage yard west, B site the warehouse east,
// mid is the corridor between them. Three lanes, corners and sightlines worth
// playing, all built from boxes. Every box is a collider for bodies and a
// surface a bullet stops on. Plain geometry only, no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [x, z]. Edges join them into the graph bots walk.
const NODES = [
  // 0-1 attacker spawn
  [-4, 16], [4, 16],
  // 2-6 A long and A site
  [-16, 12], [-18, 4], [-18, -4], [-18, -10], [-16, -13],
  // 7-12 mid
  [0, 12], [0, 6], [0, 0], [0, -6], [0, -12], [0, -16],
  // 13-17 B long and B site
  [16, 12], [18, 4], [18, -4], [18, -10], [18, -13],
  // 18-19 connectors mid <-> longs
  [-8, -4], [8, -4],
  // 20-21 defender spawn
  [-4, -16], [4, -16],
  // 22-23 A hold, 24-25 B hold, 26 mid hold
  [-14, -13], [-20, -9], [15, -13], [20, -9], [0, -8],
  // 27-28 lane mids for rotation
  [-8, 8], [8, 8],
];
const EDGES = [
  [0, 1], [0, 7], [1, 7], [0, 2], [1, 13], [0, 27], [1, 28],
  [2, 3], [3, 4], [4, 6], [4, 5], [5, 6], [5, 22], [6, 23],
  [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 20], [12, 21],
  [13, 14], [14, 15], [15, 16], [15, 17], [16, 17], [16, 24], [17, 25],
  [4, 18], [18, 9], [15, 19], [19, 9], [18, 27], [19, 28],
  [8, 27], [8, 28], [20, 12], [21, 12], [20, 21], [20, 22], [21, 24],
  [10, 26], [26, 20], [26, 21], [3, 27], [14, 28], [2, 27], [13, 28],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'rust' ? 0.25 : 0.02,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 48 x 40 m, 4 m walls, open dusk sky.
  box(48.4, 0.4, 40.4, 0, -0.2, 0, 'sand');
  box(0.6, 4, 40.4, -24.2, 2, 0, 'concrete');
  box(0.6, 4, 40.4, 24.2, 2, 0, 'concrete');
  box(48.4, 4, 0.6, 0, 2, -20.2, 'concrete');
  box(48.4, 4, 0.6, 0, 2, 20.2, 'concrete');

  // Lane walls: mid is fenced off from the longs except at the connectors (z -6..-2).
  box(0.6, 3.2, 6, -12, 1.6, 5, 'concrete'); // west lane wall, south half
  box(0.6, 3.2, 6, -12, 1.6, -11, 'concrete'); // west lane wall, north half
  box(0.6, 3.2, 6, 12, 1.6, 5, 'concrete'); // east lane wall, south half
  box(0.6, 3.2, 6, 12, 1.6, -11, 'concrete'); // east lane wall, north half

  // Pump house: the block that breaks the mid sightline toward defender spawn.
  box(4.4, 3, 4.4, 0, 1.5, -11, 'rust');
  box(5, 0.3, 5, 0, 3.15, -11, 'dark');
  // A long gatehouse and B long gatehouse.
  box(2.4, 2.6, 2.4, -18, 1.3, -1, 'ochre');
  box(2.4, 2.6, 2.4, 18, 1.3, -1, 'ochre');

  // A site, the storage yard: stacked containers for cover.
  box(6, 2.4, 2.4, -19, 1.2, -14, 'ochre');
  box(6, 2.4, 2.4, -19, 3.6, -14, 'rust');
  box(2.4, 2.4, 6, -14.5, 1.2, -12, 'teal');
  box(2.4, 1.2, 2.4, -21, 0.6, -9, 'dark');
  box(1.2, 1.1, 1.2, -16, 0.55, -9.5, 'dark');

  // B site, the warehouse: walls with two entrances, pillars, crates inside.
  box(3.2, 3.4, 0.6, 15.4, 1.7, -8.2, 'concrete'); // south wall, entrance gap x 17..19
  box(3.2, 3.4, 0.6, 20.6, 1.7, -8.2, 'concrete');
  box(0.6, 3.4, 4.2, 13.8, 1.7, -14.1, 'concrete'); // west wall, entrance gap z -12..-10
  box(0.6, 3.4, 2.2, 13.8, 1.7, -8.9, 'concrete');
  box(1, 3.4, 1, 16, 1.7, -16, 'concrete'); // pillars
  box(1, 3.4, 1, 20, 1.7, -16, 'concrete');
  box(1, 3.4, 1, 16, 1.7, -10, 'concrete');
  box(1, 3.4, 1, 20, 1.7, -10, 'concrete');
  box(2.4, 1.1, 2.4, 18, 0.55, -13, 'ochre');
  box(1.2, 1.1, 1.2, 15.5, 0.55, -15, 'dark');

  // Mid cover: the big crate at the doors, low walls, scattered crates.
  box(2.2, 2.2, 2.2, 0, 1.1, 3, 'ochre');
  box(2.2, 1.1, 1.2, -3, 0.55, -6, 'dark');
  box(2.2, 1.1, 1.2, 3, 0.55, -6, 'dark');
  box(1.2, 1.1, 1.2, -6, 0.55, 8, 'dark');
  box(1.2, 1.1, 1.2, 6, 0.55, 8, 'dark');
  box(1.6, 0.9, 1.6, -16, 0.45, 8, 'rust');
  box(1.6, 0.9, 1.6, 16, 0.45, 8, 'rust');
  box(2.4, 1.1, 1.2, -8, 0.55, 14, 'dark');
  box(2.4, 1.1, 1.2, 8, 0.55, 14, 'dark');
  box(1.2, 2.2, 1.2, -22, 1.1, 0, 'teal');
  box(1.2, 2.2, 1.2, 22, 1.1, 0, 'teal');
  box(1.2, 1.1, 1.2, -4, 0.55, -16, 'dark');
  box(1.2, 1.1, 1.2, 4, 0.55, -16, 'dark');

  // Site markers: a teal pad under each plant zone, so the objective reads at a glance.
  const padA = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 8), materials.teal);
  padA.position.set(-18, 0.03, -12);
  padA.receiveShadow = true;
  group.add(padA);
  const padB = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 8), materials.teal);
  padB.position.set(18, 0.03, -12);
  padB.receiveShadow = true;
  group.add(padB);

  // Light: low dusk sun from the west, cool sky fill, warm bounce from the sand.
  const sky = new THREE.HemisphereLight(new THREE.Color('#7a8ba0'), new THREE.Color(PALETTE.sand), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.4);
  sun.position.set(-30, 18, 12);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7f8a'), 0.5);
  fill.position.set(20, 12, -18);
  scene.add(fill);

  // Line of sight: one shared raycaster, preallocated, so bots never allocate.
  const raycaster = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  function lineBlocked(ax, ay, az, bx, by, bz) {
    from.set(ax, ay, az);
    to.set(bx, by, bz);
    dir.subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.001) return false;
    dir.divideScalar(dist);
    raycaster.set(from, dir);
    raycaster.far = dist - 0.05;
    return raycaster.intersectObjects(shootables, false).length > 0;
  }

  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    lineBlocked,
    sites: {
      A: { center: new THREE.Vector3(-18, 0, -12), half: 4 },
      B: { center: new THREE.Vector3(18, 0, -12), half: 4 },
    },
    spawns: {
      atk: [new THREE.Vector3(-4, 0, 16), new THREE.Vector3(4, 0, 16), new THREE.Vector3(-8, 0, 14), new THREE.Vector3(8, 0, 14), new THREE.Vector3(0, 0, 17)],
      def: [new THREE.Vector3(-4, 0, -16), new THREE.Vector3(4, 0, -16), new THREE.Vector3(-8, 0, -14), new THREE.Vector3(8, 0, -14), new THREE.Vector3(0, 0, -17)],
    },
    waypoints: { nodes: NODES, adjacency },
    minimapWalls: [
      // [x, z, w, d] rectangles drawn on the 2D minimap.
      [-24, 0, 1, 40], [24, 0, 1, 40], [0, -20, 48, 1], [0, 20, 48, 1],
      [-12, 5, 1, 6], [-12, -11, 1, 6], [12, 5, 1, 6], [12, -11, 1, 6],
      [0, -11, 4, 4], [-18, -1, 2, 2], [18, -1, 2, 2],
      [14, -8, 8, 1], [14, -12, 1, 8], [18, -14, 6, 2], [18, -12, 2, 6],
    ],
  };
}

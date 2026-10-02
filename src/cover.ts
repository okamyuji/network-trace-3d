// book の表紙用の静止画。scripts/cover.ts が 1000x1400 で撮影する
import * as THREE from "three";

const INK = 0x2b2d6e;

const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

const scene = new THREE.Scene();
const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

// 裏面だけを少し大きく描いて、漫画のような輪郭線にする
function add(geometry: THREE.BufferGeometry, color: number, pos: [number, number, number], outline = 0.06): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edge = new THREE.Mesh(geometry, outlineMat);
  edge.scale.setScalar(1 + outline);
  mesh.add(edge);
  scene.add(mesh);
  return mesh;
}

const floor = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 13), toon(0xb8f2d9));
floor.position.y = -0.25;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(17, 17, 0x8fdcbc, 0x8fdcbc);
grid.position.y = 0.01;
scene.add(grid);

// 端末
add(new THREE.BoxGeometry(2.0, 0.18, 1.4), 0x5aa9ff, [-6, 0.1, 3.5]);
add(new THREE.BoxGeometry(2.0, 1.3, 0.12), 0x5aa9ff, [-6, 0.85, 2.85]);
add(new THREE.BoxGeometry(1.7, 1.0, 0.02), 0xe8f6ff, [-6, 0.85, 2.92], 0);

// DNS
add(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 32), 0xb98bff, [-5.5, 0.9, -3.5]);
add(new THREE.CylinderGeometry(0.92, 0.92, 0.12, 32), 0xffffff, [-5.5, 1.3, -3.5], 0);

// ルーター
add(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 32), 0xffa24c, [-1.5, 0.3, 0.5]);

// ファイアウォール（れんがの壁）
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 3; col++) {
    const offset = row % 2 === 0 ? 0 : 0.45;
    add(new THREE.BoxGeometry(0.5, 0.48, 0.9), 0xff6b6b, [1.4, 0.26 + row * 0.5, -1.3 + col * 0.95 + offset - 0.2], 0.03);
  }
}

// ロードバランサ
add(new THREE.BoxGeometry(2.4, 0.6, 1.4), 0xffd93d, [3.8, 0.3, 0.5]);

// サーバー3台と、ランプ
const servers: THREE.Vector3[] = [];
[-3.2, 0.5, 4.2].forEach((z, i) => {
  const pos = new THREE.Vector3(7, 1.3, z);
  servers.push(pos);
  add(new THREE.BoxGeometry(1.4, 2.6, 1.4), [0x4cd98b, 0x3ccfb0, 0x4cd98b][i]!, [pos.x, pos.y, pos.z]);
  for (let k = 0; k < 3; k++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: k === 0 ? 0xff5c8a : 0xffffff }));
    lamp.position.set(pos.x - 0.71, pos.y + 0.7 - k * 0.45, pos.z + 0.4);
    scene.add(lamp);
  }
});

// 機器をつなぐパイプと、その上を流れるパケット
const tubeMat = toon(0xffffff);
const packetColors = [0xff5c8a, 0x5aa9ff, 0xffb000, 0x9b5cff];
function pipe(a: THREE.Vector3, b: THREE.Vector3, packets: number[]): void {
  const mid = a.clone().lerp(b, 0.5);
  mid.y += 1.6 + a.distanceTo(b) * 0.12;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.09, 10), tubeMat);
  tube.castShadow = true;
  scene.add(tube);
  packets.forEach((t, i) => {
    add(new THREE.SphereGeometry(0.32, 24, 16), packetColors[(i + Math.round(t * 10)) % packetColors.length]!, curve.getPoint(t).toArray() as [number, number, number], 0.12);
  });
}
const router = new THREE.Vector3(-1.5, 0.7, 0.5);
const lb = new THREE.Vector3(3.8, 0.7, 0.5);
pipe(new THREE.Vector3(-6, 0.4, 3.5), router, [0.35]);
pipe(new THREE.Vector3(-5.5, 1.9, -3.5), router, [0.6]);
pipe(router, lb, [0.3, 0.72]);
servers.forEach((s, i) => pipe(lb, new THREE.Vector3(s.x, 0.6, s.z), [[0.55], [0.4], [0.65]][i]!));

// 吹き出しのような雲と、浮かぶ小さな立方体で、にぎやかさを足す
[[9.5, 3.4, 6], [-4, 4.2, -8]].forEach(([x, y, z]) => {
  [0, 0.8, -0.8].forEach((dx, i) => add(new THREE.SphereGeometry(i === 0 ? 0.8 : 0.6, 24, 16), 0xffffff, [x! + dx, y!, z!], 0.05));
});
[[-3, 3.4, 4, 0xff5c8a], [3, 3.8, -4.5, 0x5aa9ff], [5.5, 3.2, 5, 0xffb000]].forEach(([x, y, z, c]) => {
  const cube = add(new THREE.BoxGeometry(0.6, 0.6, 0.6), c!, [x!, y!, z!], 0.1);
  cube.rotation.set(0.6, 0.8, 0.2);
});

scene.add(new THREE.HemisphereLight(0xffffff, 0xffe0f0, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);

const W = 1000;
const H = 1400;
const view = 11.5;
const camera = new THREE.OrthographicCamera((-view * W) / H, (view * W) / H, view, -view, 0.1, 200);
camera.position.set(-16, 15, 18);
camera.lookAt(0.2, 2.2, 0.5);
camera.zoom = 0.9;
camera.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("scene")!.appendChild(renderer.domElement);
renderer.render(scene, camera);
await document.fonts.ready;
Object.assign(window, { __coverReady: true });

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { Chapter, NodeKind, Step, StepStatus } from "./types.ts";

const KIND_COLOR: Record<NodeKind, number> = {
  client: 0x60a5fa,
  server: 0x4ade80,
  dns: 0xc084fc,
  router: 0xfb923c,
  firewall: 0xf87171,
  proxy: 0x2dd4bf,
  lb: 0xfacc15,
  ca: 0xf9a8d4,
};

const STATUS_COLOR: Record<StepStatus, number> = {
  ok: 0x38bdf8,
  fail: 0xef4444,
  wait: 0xf59e0b,
};

const MOVE_MS = 900;

function geometryFor(kind: NodeKind): THREE.BufferGeometry {
  switch (kind) {
    case "client":
      return new THREE.BoxGeometry(1.3, 0.9, 0.2);
    case "server":
      return new THREE.BoxGeometry(0.9, 1.6, 0.9);
    case "dns":
      return new THREE.CylinderGeometry(0.55, 0.55, 1.1, 24);
    case "router":
      return new THREE.CylinderGeometry(0.7, 0.7, 0.35, 24);
    case "firewall":
      return new THREE.BoxGeometry(0.25, 1.8, 2.6);
    case "proxy":
      return new THREE.OctahedronGeometry(0.7);
    case "lb":
      return new THREE.BoxGeometry(1.7, 0.5, 1.0);
    case "ca":
      return new THREE.DodecahedronGeometry(0.6);
  }
}

function label(text: string, className: string): CSS2DObject {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return new CSS2DObject(div);
}

interface NodeView {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  state: CSS2DObject;
  base: THREE.Vector3;
}

export interface Stage {
  load(chapter: Chapter): void;
  show(step: Step | undefined): void;
  renderCalls(): number;
  /** パケットの移動が終わったら true。E2Eで静止画を撮る合図に使う。 */
  settled(): boolean;
}

export function createStage(container: HTMLElement): Stage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "labels";
  container.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, labels.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  scene.add(new THREE.GridHelper(30, 30, 0x334155, 0x1e293b));

  const world = new THREE.Group();
  scene.add(world);
  const nodes = new Map<string, NodeView>();

  const packet = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 16),
    new THREE.MeshStandardMaterial({
      color: STATUS_COLOR.ok,
      emissive: STATUS_COLOR.ok,
      emissiveIntensity: 0.6,
    }),
  );
  const packetLabel = label("", "packet-label");
  packetLabel.position.set(0, 0.45, 0);
  packet.add(packetLabel);
  packet.visible = false;
  scene.add(packet);

  const trailMaterial = new THREE.LineBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.6,
  });
  let trail: THREE.Line | undefined;
  let curve: THREE.QuadraticBezierCurve3 | undefined;
  let stopAt = 1;
  let status: StepStatus = "ok";
  let startedAt = 0;

  const bounds = new THREE.Box3(new THREE.Vector3(-6, 0, -3), new THREE.Vector3(6, 2, 3));
  const VIEW_DIR = new THREE.Vector3(-0.12, 0.62, 1).normalize();

  // ノードを囲む箱の角がすべて画面の内側に入る最短の距離を二分探索で求める。章ごとに配置の広さが違うため
  function fitCamera(): void {
    const center = bounds.getCenter(new THREE.Vector3());
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) =>
        new THREE.Vector3(
          i & 1 ? bounds.max.x : bounds.min.x,
          i & 2 ? bounds.max.y : bounds.min.y,
          i & 4 ? bounds.max.z : bounds.min.z,
        ),
    );
    const placeAt = (distance: number): void => {
      camera.position.copy(center).addScaledVector(VIEW_DIR, distance);
      camera.lookAt(center);
      camera.updateMatrixWorld();
    };
    const fits = (): boolean =>
      corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.9;
      });
    let near = 2;
    let far = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      placeAt(mid);
      if (fits()) far = mid;
      else near = mid;
    }
    placeAt(far);
    controls.target.copy(center);
  }

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = container;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
    fitCamera();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function clearWorld(): void {
    world.traverse((obj) => {
      if (obj instanceof CSS2DObject) obj.element.remove();
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    world.clear();
    nodes.clear();
  }

  function load(chapter: Chapter): void {
    clearWorld();
    for (const zone of chapter.zones ?? []) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(zone.size[0], zone.size[1]),
        new THREE.MeshStandardMaterial({
          color: zone.color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
        }),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(...zone.center);
      const zoneLabel = label(zone.label, "zone-label");
      zoneLabel.position.set(0, -zone.size[1] / 2 + 0.3, 0.05);
      plate.add(zoneLabel);
      world.add(plate);
    }
    for (const n of chapter.nodes) {
      const color = KIND_COLOR[n.kind];
      const mesh = new THREE.Mesh(
        geometryFor(n.kind),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.05,
          transparent: n.kind === "firewall",
          opacity: n.kind === "firewall" ? 0.75 : 1,
        }),
      );
      const base = new THREE.Vector3(...n.pos);
      mesh.position.copy(base);
      const name = label(n.label, "node-label");
      name.position.set(0, 1.2, 0);
      mesh.add(name);
      const state = label("", "state-label");
      state.position.set(0, -1.05, 0);
      mesh.add(state);
      world.add(mesh);
      nodes.set(n.id, { mesh, state, base });
    }
    bounds.makeEmpty();
    for (const n of chapter.nodes) bounds.expandByPoint(new THREE.Vector3(...n.pos));
    bounds.expandByVector(new THREE.Vector3(1.2, 0, 1.2));
    bounds.max.y += 1.6;
    fitCamera();
  }

  function highlight(focus: string[], state: Record<string, string>): void {
    for (const [id, view] of nodes) {
      const focused = focus.includes(id);
      view.mesh.material.emissiveIntensity = focused ? 0.7 : 0.05;
      view.mesh.scale.setScalar(focused ? 1.12 : 1);
      view.state.element.textContent = state[id] ?? "";
    }
  }

  function clearPacket(): void {
    trail?.geometry.dispose();
    if (trail) scene.remove(trail);
    trail = undefined;
    curve = undefined;
    packet.visible = false;
    // CSS2D のラベルは親の visible を見ないため、文字を消さないと前の手順のラベルが残る
    packetLabel.element.textContent = "";
  }

  // 失敗は相手の手前で止め、待ちは途中で止める。止まった位置で「どこまで届いたか」を見せる。
  const STOP_AT: Record<StepStatus, number> = { ok: 1, fail: 0.82, wait: 0.5 };

  function launch(from: NodeView, to: NodeView, label: string, next: StepStatus): void {
    const a = from.base.clone();
    const b = to.base.clone();
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.5 + a.distanceTo(b) * 0.15;
    curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    trail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
      trailMaterial,
    );
    scene.add(trail);
    status = next;
    stopAt = STOP_AT[next];
    packet.material.color.setHex(STATUS_COLOR[next]);
    packet.material.emissive.setHex(STATUS_COLOR[next]);
    packetLabel.element.textContent = label + (next === "fail" ? " ×" : "");
    packet.position.copy(a);
    packet.visible = true;
    startedAt = performance.now();
  }

  function show(step: Step | undefined): void {
    highlight(step?.focus ?? [], step?.state ?? {});
    clearPacket();
    const from = nodes.get(step?.from ?? "");
    const to = nodes.get(step?.to ?? "");
    if (step && from && to) launch(from, to, step.packet ?? "", step.status ?? "ok");
  }

  function animate(now: number): void {
    if (curve) {
      const t = Math.min((now - startedAt) / MOVE_MS, 1);
      packet.position.copy(curve.getPoint(t * stopAt));
      const pulse = status === "wait" && t >= 1 ? 1 + 0.25 * Math.sin(now / 150) : 1;
      packet.scale.setScalar(pulse);
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    load,
    show,
    renderCalls: () => renderer.info.render.calls,
    settled: () => !curve || performance.now() - startedAt >= MOVE_MS,
  };
}

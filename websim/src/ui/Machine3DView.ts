// Left panel: a Gaggia Classic Pro in 3D that you can orbit, laid out as in Gaggia's parts diagram:
// the tank in the base behind the drip tray, filled through a chute from the lid on top; the Ulka
// pump upright in the rear left corner with the OPV on its head; the boiler sitting on the group
// with the 3-way solenoid on its right and the dump tube straight down to the drip tray; the steam
// valve across the top to the knob on the right side. The body is see-through and the group and
// portafilter are glass. Readings glow on the parts themselves, coloured by what they measure.
// Units are centimetres: x to the right, y up, z towards the viewer, the front panel at z = 12.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Simulation } from '../host/Simulation.js';
import { PIN } from '../host/Simulation.js';

const W = 23; // body width
const D = 24; // body depth
const H = 38; // body height
const FRONT = D / 2;
const BACK = -D / 2;
const SIDE = W / 2;
const CAVITY_TOP = 24; // underside of the upper front section, where the group comes through
const GRATE_Y = 5;

const TANK = { x0: -9.6, x1: 9.6, z0: BACK + 0.6, z1: -0.6, y0: 2.4, y1: 13.6 };
const PUMP = { x: -7.4, z: -8.4, y0: 15.4 }; // standing in the rear left corner
const BOILER = { x: 0, z: 5, y0: 24.6, y1: 30.6, r: 5 };
const GROUP = { y0: 21.9, y1: BOILER.y0, r: 3.7 };
const BASKET = { r: 2.9, y0: 19.3, y1: GROUP.y0 };
const PUCK_R = 2.85;
const SPOUT_Y = 17.9;
const SCALE_TOP = GRATE_Y + 2;
const SCALE_Z = BOILER.z + 0.5;
const CUP = { rBottom: 2.6, rTop: 3.4, height: 6, capacityMl: 110 };
const TRAY = { x: 9.2, z0: 0.9, z1: 12.6, y0: 2.2, depth: 2.6 };
const STEAM_VALVE = { y: 32, z: 8 };
const WAND_TIP = new THREE.Vector3(8.8, 12.5, 12.2);

const COLORS = {
  shell: 0xc9ced6,
  water: 0x3d7fd6,
  hotWater: 0xe07b39,
  coffee: 0x5a3a22,
  crema: 0xc08a4f,
  dryPuck: 0x8a6440,
  wetPuck: 0x3a2414,
  brass: 0xc9a14a,
  steel: 0xc4c9cf,
  rubber: 0x2a2a2a,
};

/** Display colours by what they measure; the legend under the model uses the same ones. */
export const READING_COLORS = {
  temperature: '#ff3b30',
  pressure: '#34ff6b',
  water: '#3aa0ff',
  coffee: '#ffb020',
  puck: '#d4864a',
} as const;

// Blue (cold) -> amber -> red (hot) for 20..150 °C.
function tempColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.max(0, Math.min(1, (t - 20) / 110));
  return out.setHSL((215 - 215 * x) / 360, 0.7, (52 - 8 * x) / 100);
}

const glass = (color: number, opacity: number) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
const solid = (color: number, metalness = 0.3, roughness = 0.45) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
const liquid = (color: number, opacity = 0.6) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.15, depthWrite: false });

// A glowing LED/neon readout: a dark window with digits in the reading's colour, drawn on a canvas
// that is mapped onto a flat panel or a band around a cylinder.
class Led {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private shown = '';

  private readonly core: string; // the bright centre of the glow

  constructor(private readonly color: string, widthCm: number, heightCm: number) {
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    this.core = `rgb(${rgb.map(c => Math.round(c + (255 - c) * 0.55)).join(',')})`;
    this.canvas.width = Math.round(widthCm * 64);
    this.canvas.height = Math.round(heightCm * 64);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false });
  }

  /** A flat panel facing +z. */
  panel(widthCm: number, heightCm: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthCm, heightCm), this.material);
    mesh.renderOrder = 3;
    return mesh;
  }

  /** A band around a vertical cylinder of radius `r`, centred on its +z side. */
  band(r: number, y0: number, y1: number, arcCm: number): THREE.Mesh {
    const arc = arcCm / r;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 48, 1, true, -arc / 2, arc), this.material);
    mesh.position.y = (y0 + y1) / 2;
    mesh.renderOrder = 3;
    return mesh;
  }

  set(value: string, caption = ''): void {
    const key = `${value}\n${caption}`;
    if (key === this.shown) return;
    this.shown = key;
    const g = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10, 10, 12, 0.78)';
    g.beginPath();
    g.roundRect(2, 2, w - 4, h - 4, h * 0.14);
    g.fill();
    const glow = (text: string, size: number, y: number) => {
      g.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      const fit = Math.min(1, (w * 0.9) / g.measureText(text).width);
      g.font = `700 ${size * fit}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = this.color;
      g.fillStyle = this.color;
      g.shadowBlur = size * 0.45;
      g.fillText(text, w / 2, y);
      g.fillText(text, w / 2, y);
      g.shadowBlur = size * 0.08;
      g.fillStyle = this.core;
      g.fillText(text, w / 2, y);
    };
    if (caption) {
      glow(value, h * 0.5, h * 0.4);
      glow(caption, h * 0.2, h * 0.79);
    } else {
      glow(value, h * 0.62, h * 0.52);
    }
    g.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }
}

// A hose with water stripes that run along it at a speed proportional to the flow.
class Pipe {
  private readonly core: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  private readonly map: THREE.Texture;

  constructor(parent: THREE.Object3D, points: [number, number, number][], stripes: THREE.Texture, color: number, radius = 0.28) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, radius, 10), glass(0xdfe3e8, 0.35));
    hose.renderOrder = 1;
    this.map = stripes.clone();
    this.map.needsUpdate = true;
    this.map.repeat.set(curve.getLength() / 1.6, 1);
    this.core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, radius * 0.6, 8),
      new THREE.MeshBasicMaterial({ color, map: this.map, transparent: true, depthWrite: false }),
    );
    parent.add(hose, this.core);
  }

  /** `q` in ml/s; zero hides the water. */
  flow(q: number, dt: number): void {
    this.core.visible = q > 0.02;
    this.map.offset.x -= Math.min(4, q) * 0.9 * dt;
  }
}

// A vertical stream of liquid from `top` down to `bottomY`, thicker with more flow.
class Stream {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, color: number) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    geometry.translate(0, -0.5, 0); // hang from the top
    this.mesh = new THREE.Mesh(geometry, liquid(color, 0.8));
    parent.add(this.mesh);
  }
  set(top: THREE.Vector3, bottomY: number, q: number, perMlRadius = 0.07): void {
    const length = top.y - bottomY;
    this.mesh.visible = q > 0.02 && length > 0;
    if (!this.mesh.visible) return;
    const r = Math.min(0.45, 0.05 + perMlRadius * Math.sqrt(q));
    this.mesh.position.copy(top);
    this.mesh.scale.set(r, length, r);
  }
}

export class Machine3DView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 0.8, 1, 500);
  private readonly controls: OrbitControls;
  // Front left, so the pump in the rear left corner isn't hidden behind the boiler.
  private readonly home = { position: new THREE.Vector3(-44, 42, 80), target: new THREE.Vector3(0, 18, 2) };
  private readonly pipes: Record<string, Pipe> = {};
  private readonly leds: Record<string, Led> = {};
  private readonly parts: Record<string, THREE.Mesh> = {};
  private readonly groups: Record<string, THREE.Group> = {};
  private readonly streams: Record<string, Stream> = {};
  private readonly scratch = new THREE.Color();
  private heaterGlow = 0;
  private pumpAvg = 0; // the pump moves water in half-sine strokes; the display shows the average
  private opvAvg = 0;
  private cupLevel = -1;
  private lastMs = performance.now();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // throws without WebGL
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.classList.add('machine-3d');
    container.append(this.renderer.domElement, Machine3DView.legend());
    const hint = document.createElement('div');
    hint.className = 'm3d-hint';
    hint.textContent = 'Drag to rotate · scroll to zoom · double-click to reset';
    container.append(hint);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 140;
    this.resetView();
    this.renderer.domElement.addEventListener('dblclick', () => this.resetView());

    // A soft studio environment so brass and steel reflect something.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(25, 50, 40);
    this.scene.add(key);

    const stripes = Machine3DView.stripeTexture();
    this.buildBody();
    this.buildTankAndPump(stripes);
    this.buildBoilerAndGroup(stripes);
    this.buildPortafilter();
    this.buildTrayCupAndScale();
    this.buildSteam(stripes);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resetView(): void {
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private box(parent: THREE.Object3D, size: [number, number, number], center: [number, number, number], material: THREE.Material, edges = false): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...center);
    parent.add(mesh);
    if (edges) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x8b8f96, transparent: true, opacity: 0.6 }));
      lines.position.copy(mesh.position);
      parent.add(lines);
    }
    return mesh;
  }

  private cylinder(parent: THREE.Object3D, r: number, y0: number, y1: number, material: THREE.Material, x = 0, z = 0, open = false, rTop = r): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, y1 - y0, 40, 1, open), material);
    mesh.position.set(x, (y0 + y1) / 2, z);
    parent.add(mesh);
    return mesh;
  }

  private led(name: string, color: string, widthCm: number, heightCm: number): Led {
    return (this.leds[name] = new Led(color, widthCm, heightCm));
  }

  private buildBody(): void {
    const s = this.scene;
    const shell = glass(COLORS.shell, 0.09);
    const panels = [
      this.box(s, [0.3, H, D], [-SIDE, H / 2, 0], shell, true),
      this.box(s, [0.3, H, D], [SIDE, H / 2, 0], shell, true),
      this.box(s, [W, H, 0.3], [0, H / 2, BACK], shell, true),
      this.box(s, [W, 0.4, D], [0, H, 0], shell, true), // cup warmer
      this.box(s, [W, H - CAVITY_TOP, 0.3], [0, (H + CAVITY_TOP) / 2, FRONT], shell, true), // control panel
      this.box(s, [W, 0.3, FRONT], [0, CAVITY_TOP, FRONT / 2], shell, true), // cavity ceiling
      this.box(s, [W, CAVITY_TOP - TANK.y1, 0.3], [0, (CAVITY_TOP + TANK.y1) / 2, 0], shell, true), // cavity back wall, above the tank
      this.box(s, [W, 2, D], [0, 1, 0], glass(COLORS.steel, 0.25), true), // base
    ];
    for (const p of panels) p.renderOrder = 2;
    for (const [x, z] of [[-9.5, -10], [9.5, -10], [-9.5, 10], [9.5, 10]]) this.cylinder(s, 0.9, -0.01, 0.6, solid(COLORS.rubber, 0, 0.9), x, z);

    // Name plate and the three rocker switches (power, brew, steam).
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.3), new THREE.MeshBasicMaterial({ map: Machine3DView.nameTexture(), transparent: true }));
    plate.position.set(-7.4, 26.2, FRONT + 0.2); // left of the boiler readout behind it
    s.add(plate);
    for (const [name, x] of [['power', 2.5], ['brew', 5.6], ['steam', 8.7]] as const) {
      this.parts[`switch-${name}`] = this.box(s, [2.2, 3, 0.8], [x, 34.5, FRONT + 0.4], new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.4, emissive: 0xff8a2a, emissiveIntensity: 0 }));
    }

    // GaggiMate controller board on the left wall, where the stock board sits.
    const pcb = this.box(s, [0.15, 7, 9], [-SIDE + 0.5, 30.5, 4], solid(0x1f6f3a, 0.2, 0.6));
    for (const [y, z, sx, sy, sz] of [[31.5, 2, 0.5, 1.6, 2.4], [28.8, 5.5, 0.6, 1.2, 1.2], [32.6, 6.4, 0.4, 0.8, 1.8]]) {
      this.box(s, [sx, sy, sz], [pcb.position.x + 0.3, y, z], solid(0x222428, 0.3, 0.5));
    }

    // Floor and a soft contact shadow.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(36, 64), new THREE.MeshBasicMaterial({ map: Machine3DView.shadowTexture(), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    s.add(floor);
  }

  private buildTankAndPump(stripes: THREE.Texture): void {
    const s = this.scene;
    const t = TANK;
    const cx = (t.x0 + t.x1) / 2;
    const cz = (t.z0 + t.z1) / 2;
    // The tank fills the base behind the drip tray; a chute from the lid on top feeds it.
    this.box(s, [t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0], [cx, (t.y0 + t.y1) / 2, cz], glass(0xdfe9f3, 0.16), true).renderOrder = 1;
    const water = this.box(s, [t.x1 - t.x0 - 0.3, 1, t.z1 - t.z0 - 0.3], [cx, t.y0, cz], liquid(COLORS.water, 0.45));
    water.geometry.translate(0, 0.5, 0); // grows up from the tank floor
    this.parts.tankWater = water;
    this.box(s, [6, H - t.y1 - 0.4, 4.2], [4.2, (H + t.y1) / 2, -7.8], glass(0xdfe9f3, 0.12), true).renderOrder = 1; // fill chute
    this.box(s, [7.4, 0.15, 5.6], [4.2, H + 0.25, -7.8], glass(0x9aa3ad, 0.3), true); // lid
    const tankLed = this.led('tank', READING_COLORS.water, 6.4, 3).panel(6.4, 3);
    tankLed.position.set(-5.4, 9.6, t.z1 + 0.02);
    s.add(tankLed);

    // Ulka vibratory pump standing in the rear left corner on its bracket, OPV on its head.
    const pump = (this.groups.pump = new THREE.Group());
    pump.position.set(PUMP.x, PUMP.y0, PUMP.z);
    pump.rotation.y = -0.6; // turned towards the front left so its readout faces the default view
    const coil = new THREE.Mesh(new THREE.BoxGeometry(4.6, 6, 5), solid(0x232428, 0.2, 0.55));
    coil.position.y = 3.4;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 4.6, 24), solid(COLORS.steel, 0.85, 0.3));
    tube.position.y = 8.7;
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 16), solid(COLORS.brass, 0.85, 0.3));
    inlet.position.y = 0.1;
    const opv = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 20), solid(COLORS.brass, 0.85, 0.3));
    opv.position.y = 12;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(5.4, 9, 0.5), solid(0x3a3d42, 0.1, 0.7));
    bracket.position.set(0, 4.5, -2.9);
    const pumpLed = this.led('pump', READING_COLORS.pressure, 4.2, 3.2).panel(4.2, 3.2);
    pumpLed.position.set(0, 3.4, 2.52);
    pump.add(coil, tube, inlet, opv, bracket, pumpLed);
    s.add(pump);

    const top = PUMP.y0 + 13.1;
    this.pipes.intake = new Pipe(s, [[PUMP.x, t.y0 + 0.8, PUMP.z], [PUMP.x, t.y1, PUMP.z], [PUMP.x, PUMP.y0 - 0.4, PUMP.z]], stripes, COLORS.water);
    this.pipes.opv = new Pipe(s, [[PUMP.x + 0.9, top - 0.8, PUMP.z], [PUMP.x + 3, top + 0.4, PUMP.z - 1.4], [PUMP.x + 3.4, 24, PUMP.z - 2], [PUMP.x + 3.4, t.y1 - 1.5, PUMP.z - 2]], stripes, COLORS.water, 0.22);
    this.pipes.feed = new Pipe(s, [[PUMP.x, top, PUMP.z], [PUMP.x, top + 2.6, PUMP.z + 2.4], [-5.6, 33.4, -1.5], [-5.4, 29, 3], [-4.2, BOILER.y0 + 0.5, 4.4]], stripes, COLORS.water);
    this.cylinder(s, 0.7, 33.6, 35.2, solid(COLORS.steel, 0.85, 0.3), -5.7, -0.4); // GaggiMate pressure transducer on a tee
  }

  private buildBoilerAndGroup(stripes: THREE.Texture): void {
    const s = this.scene;
    const b = BOILER;
    // Brass boiler sitting on the group, with the heating element in its base.
    const boiler = this.cylinder(s, b.r, b.y0, b.y1, new THREE.MeshStandardMaterial({ color: COLORS.brass, metalness: 0.9, roughness: 0.28, transparent: true, opacity: 0.8, emissive: 0xff4a10, emissiveIntensity: 0 }), b.x, b.z);
    boiler.renderOrder = 1;
    this.parts.boiler = boiler;
    this.parts.boilerWater = this.cylinder(s, b.r - 0.45, b.y0 + 0.3, b.y1 - 0.3, liquid(COLORS.hotWater, 0.55), b.x, b.z);
    const heater = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.32, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.6, roughness: 0.4, emissive: 0xff5a14, emissiveIntensity: 0 }),
    );
    heater.rotation.x = Math.PI / 2;
    heater.position.set(b.x, b.y0 + 0.7, b.z);
    s.add(heater);
    this.parts.heater = heater;
    for (const [x, z] of [[-2, 3.5], [2, 3.5]]) this.box(s, [1.2, 1, 1.6], [x, b.y1 + 0.5, z], solid(0xe6e2d8, 0.1, 0.6)); // element terminals
    this.cylinder(s, 0.35, b.y1, b.y1 + 1.4, solid(COLORS.steel, 0.85, 0.3), 2.4, b.z + 2); // thermocouple
    const boilerLed = this.led('boiler', READING_COLORS.temperature, 7.6, 3.6).band(b.r + 0.04, 25.6, 29.2, 7.6);
    boilerLed.position.x = b.x;
    boilerLed.position.z = b.z;
    s.add(boilerLed);

    // 3-way solenoid on the boiler's right; when it closes, the group dumps straight down into the tray.
    this.parts.valve = this.box(s, [2.2, 2.2, 2.2], [6.4, 24.9, 7.4], new THREE.MeshStandardMaterial({ color: COLORS.brass, metalness: 0.85, roughness: 0.3, emissive: 0x20c0ff, emissiveIntensity: 0 }));
    this.cylinder(s, 1, 26, 28.4, solid(0x1d1d1f, 0.1, 0.6), 6.4, 7.4);
    this.pipes.brew = new Pipe(s, [[3.9, b.y0 + 0.4, 6.8], [5.3, 24.9, 7.4], [4.8, 23.9, 7.6], [2.8, 23.3, 6.6]], stripes, COLORS.hotWater, 0.24);
    this.pipes.dump = new Pipe(s, [[7.5, 24.7, 7.4], [8.3, 23, 1.2], [8.3, 6.5, 1.2], [8.3, TRAY.y0 + 1.6, 1.4]], stripes, COLORS.hotWater, 0.26);

    // Glass group head with its shower screen.
    this.cylinder(s, GROUP.r, GROUP.y0, GROUP.y1, glass(0xe8f1fa, 0.22), b.x, b.z).renderOrder = 1;
    this.cylinder(s, BASKET.r, GROUP.y0 - 0.03, GROUP.y0 + 0.03, glass(0x9aa3ad, 0.6), b.x, b.z);
    const groupLed = this.led('group', READING_COLORS.temperature, 5, 2.2).band(GROUP.r + 0.04, GROUP.y0 + 0.25, GROUP.y1 - 0.25, 5);
    groupLed.position.x = b.x;
    groupLed.position.z = b.z;
    s.add(groupLed);
  }

  private buildPortafilter(): void {
    const pf = (this.groups.portafilter = new THREE.Group());
    pf.position.set(BOILER.x, 0, BOILER.z);
    this.scene.add(pf);
    this.cylinder(pf, 3.5, 18.8, BASKET.y1, glass(0xe8f1fa, 0.2), 0, 0, true).renderOrder = 1;
    this.cylinder(pf, 3.5, 18.75, 18.85, glass(0xe8f1fa, 0.3));
    this.cylinder(pf, BASKET.r, BASKET.y0, BASKET.y1, glass(0xf2f6fa, 0.28), 0, 0, true).renderOrder = 1;
    this.cylinder(pf, BASKET.r, BASKET.y0 - 0.05, BASKET.y0, glass(0x9aa3ad, 0.4));
    // Handle towards the viewer, slightly down, as when locked in.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1, 10, 20), glass(0x1d1d1f, 0.55));
    handle.rotation.x = Math.PI / 2 - 0.12;
    handle.position.set(0, 19.6, 9.8);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 16), glass(0xe8f1fa, 0.35));
    neck.rotation.x = Math.PI / 2;
    neck.position.set(0, 20.2, 4.2);
    pf.add(handle, neck);
    for (const x of [-0.9, 0.9]) this.cylinder(pf, 0.28, SPOUT_Y, 18.8, glass(0xe8f1fa, 0.4), x, 0);

    // Puck: the wet part (dark, from the top) grows down through the dry grounds.
    this.parts.puckDry = this.cylinder(pf, PUCK_R, 0, 1, solid(COLORS.dryPuck, 0, 0.95));
    this.parts.puckWet = this.cylinder(pf, PUCK_R, 0, 1, solid(COLORS.wetPuck, 0, 0.8));
    this.parts.headspace = this.cylinder(pf, PUCK_R, 0, 1, liquid(COLORS.hotWater, 0.5));
    for (const name of ['puckDry', 'puckWet', 'headspace']) this.parts[name].geometry.translate(0, 0.5, 0); // spans y 0..1, see place()
    // The puck readout wraps the portafilter wall on the left, clear of the handle.
    const puckLed = this.led('puck', READING_COLORS.puck, 5.6, 2.6).band(3.54, 18.95, 21.55, 5.6);
    puckLed.rotation.y = -Math.PI / 3;
    pf.add(puckLed);
  }

  private buildTrayCupAndScale(): void {
    const s = this.scene;
    const t = TRAY;
    this.box(s, [2 * t.x + 0.6, t.depth + 0.4, t.z1 - t.z0 + 0.6], [0, t.y0 + t.depth / 2, (t.z0 + t.z1) / 2], glass(COLORS.steel, 0.22), true).renderOrder = 1;
    this.box(s, [2 * t.x, 0.2, t.z1 - t.z0], [0, GRATE_Y, (t.z0 + t.z1) / 2], glass(COLORS.steel, 0.45), true).renderOrder = 1;
    const drip = this.box(s, [2 * t.x - 0.2, 1, t.z1 - t.z0 - 0.2], [0, t.y0, (t.z0 + t.z1) / 2], liquid(COLORS.water, 0.4));
    drip.geometry.translate(0, 0.5, 0);
    this.parts.drip = drip;
    const trayLed = this.led('tray', READING_COLORS.water, 5.6, 2).panel(5.6, 2);
    trayLed.position.set(-5.4, t.y0 + t.depth / 2 + 0.2, t.z1 + 0.33);
    s.add(trayLed);

    // BLE scale on the grate with its own readout, cup on the scale.
    this.box(s, [10.5, SCALE_TOP - GRATE_Y - 0.1, 10.5], [0, (GRATE_Y + 0.1 + SCALE_TOP) / 2, SCALE_Z], solid(0x2b2c30, 0.2, 0.5), true);
    const scaleLed = this.led('scale', READING_COLORS.coffee, 6.4, 1.5).panel(6.4, 1.5);
    scaleLed.position.set(0, (GRATE_Y + SCALE_TOP) / 2 + 0.05, SCALE_Z + 5.27);
    s.add(scaleLed);

    const cup = (this.groups.cup = new THREE.Group());
    cup.position.set(BOILER.x, SCALE_TOP, SCALE_Z);
    s.add(cup);
    const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(CUP.rBottom, 0), new THREE.Vector2(CUP.rTop, CUP.height)];
    const wall = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), glass(0xf4f7fa, 0.25));
    wall.renderOrder = 1;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.28, 10, 24, Math.PI), glass(0xf4f7fa, 0.35));
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(CUP.rTop - 0.2, CUP.height * 0.55, 0);
    cup.add(wall, handle);
    this.parts.coffee = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40), liquid(COLORS.coffee, 0.85));
    this.parts.crema = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: COLORS.crema, roughness: 0.8, side: THREE.DoubleSide }));
    this.parts.crema.rotation.x = -Math.PI / 2;
    cup.add(this.parts.coffee, this.parts.crema);

    this.streams.coffeeL = new Stream(s, COLORS.coffee);
    this.streams.coffeeR = new Stream(s, COLORS.coffee);
    this.streams.group = new Stream(s, COLORS.hotWater);
  }

  private buildSteam(stripes: THREE.Texture): void {
    const s = this.scene;
    const v = STEAM_VALVE;
    // Steam valve across the top to the knob on the right side; the wand leaves the front right corner.
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 4, 20), solid(COLORS.brass, 0.85, 0.3));
    valve.rotation.z = Math.PI / 2;
    valve.position.set(8.4, v.y, v.z);
    s.add(valve);
    const knob = (this.groups.knob = new THREE.Group());
    knob.position.set(SIDE + 0.9, v.y, v.z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.4, 32), solid(0x1d1d1f, 0.1, 0.5));
    cap.rotation.z = Math.PI / 2;
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xe6e6e6 }));
    pointer.position.set(0.72, 0.7, 0);
    knob.add(cap, pointer);
    s.add(knob);
    const wandCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(10.2, v.y - 0.4, v.z + 0.6), new THREE.Vector3(11, 28, 12.4), new THREE.Vector3(10, 21, 12.8), WAND_TIP.clone()], false, 'centripetal');
    s.add(new THREE.Mesh(new THREE.TubeGeometry(wandCurve, 48, 0.42, 12), solid(COLORS.steel, 0.95, 0.2)));
    this.pipes.wand = new Pipe(s, [[2.6, BOILER.y1 - 0.2, 6.2], [4, v.y, 7.4], [6.4, v.y, v.z]], stripes, COLORS.hotWater, 0.24);
    this.streams.wand = new Stream(s, COLORS.water);
  }

  update(sim: Simulation): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const m = sim.machine;
    const p = m.params;
    const material = (name: string) => this.parts[name].material as THREE.MeshStandardMaterial;

    // Tank
    const tankLevel = Math.max(0, Math.min(1, m.tankMl / p.tankCapacityMl));
    this.parts.tankWater.visible = tankLevel > 0.002;
    this.parts.tankWater.scale.y = Math.max(0.001, tankLevel * (TANK.y1 - TANK.y0 - 0.3));
    this.leds.tank.set(`${(m.tankMl / 1000).toFixed(2)} L`, 'tank');

    // Pump: it buzzes while it strokes and shows the pressure it works against.
    const k = Math.min(1, dt * 4);
    this.pumpAvg += (m.qPump - this.pumpAvg) * k;
    this.opvAvg += (m.qOpv - this.opvAvg) * k;
    const stroking = m.qPump > 0.1;
    this.groups.pump.position.x = PUMP.x + (stroking ? (sim.nowMs % 20 < 10 ? 0.05 : -0.05) : 0);
    const pumpCaption = this.pumpAvg < 0.05 ? 'idle' : this.opvAvg > 0.05 ? `${this.pumpAvg.toFixed(1)} ml/s · OPV ${this.opvAvg.toFixed(1)}` : `${this.pumpAvg.toFixed(1)} ml/s`;
    this.leds.pump.set(`${m.pressure.toFixed(1)} bar`, pumpCaption);
    this.pipes.intake.flow(m.qPump, dt);
    this.pipes.feed.flow(Math.max(0, m.qPump - m.qOpv), dt);
    this.pipes.opv.flow(m.qOpv, dt);

    // Boiler: water colour follows its temperature; the element and the brass glow while it heats.
    material('boilerWater').color.copy(tempColor(m.waterC, this.scratch));
    this.heaterGlow += ((m.heaterOn ? 1 : 0) - this.heaterGlow) * Math.min(1, dt * 6);
    material('heater').emissiveIntensity = 2.2 * this.heaterGlow;
    material('boiler').emissiveIntensity = 0.12 * this.heaterGlow;
    this.leds.boiler.set(`${m.waterC.toFixed(1)}°C`, m.heaterOn ? 'boiler · heating' : 'boiler');
    this.leds.group.set(`${m.brewWaterC.toFixed(0)}°C`, 'brew water');

    const valveOpen = sim.pin('controller', PIN.VALVE);
    material('valve').emissiveIntensity = valveOpen ? 0.6 : 0;
    this.pipes.brew.flow(m.qGroup, dt);
    this.pipes.dump.flow(!valveOpen && m.headspaceMl > 0.05 ? 2 : 0, dt);
    this.pipes.wand.flow(m.qWand, dt);

    // Portafilter, puck and headspace
    const basket = p.basket;
    this.groups.portafilter.visible = basket !== 'empty';
    const hasPuck = basket === 'puck';
    const puckH = hasPuck ? Math.min(BASKET.y1 - BASKET.y0 - 0.2, m.puck.heightMm() / 10) : 0;
    const wet = hasPuck ? m.puck.saturation() : 0;
    const puckTop = BASKET.y0 + puckH;
    this.place('puckDry', BASKET.y0, BASKET.y0 + puckH * (1 - wet), hasPuck && wet < 0.999);
    this.place('puckWet', BASKET.y0 + puckH * (1 - wet), puckTop, hasPuck && wet > 0.001);
    const head = Math.max(0, Math.min(1, m.headspaceMl / p.headspaceMl));
    this.place('headspace', puckTop, puckTop + head * (BASKET.y1 - puckTop), basket !== 'empty' && head > 0.01);
    material('headspace').color.copy(tempColor(m.brewWaterC, this.scratch));
    if (hasPuck) this.leds.puck.set(`${Math.round(wet * 100)}% wet`, `${p.doseG} g · R ${m.puck.resistance().toFixed(2)}`);
    else this.leds.puck.set('blind', 'no puck');

    // Streams into the cup (or the drip tray without one)
    const liquidTop = p.cupPresent ? SCALE_TOP + 0.15 + Math.max(0, this.cupLevel) * CUP.height : TRAY.y0 + 0.2;
    this.streams.coffeeL.set(new THREE.Vector3(-0.9, SPOUT_Y, BOILER.z), liquidTop, hasPuck ? m.qCup / 2 : 0);
    this.streams.coffeeR.set(new THREE.Vector3(0.9, SPOUT_Y, BOILER.z), liquidTop, hasPuck ? m.qCup / 2 : 0);
    this.streams.group.set(new THREE.Vector3(0, GROUP.y0, BOILER.z), liquidTop, basket === 'empty' ? m.qGroup : 0, 0.12);
    this.streams.wand.set(WAND_TIP, TRAY.y0 + 0.2, m.qWand, 0.12);

    // Cup, scale, drip tray
    this.groups.cup.visible = p.cupPresent;
    this.updateCup(Math.max(0, Math.min(1, m.cupMl / CUP.capacityMl)));
    this.leds.scale.set(sim.scale.params.connected ? `${sim.scale.lastReading.toFixed(1)} g` : '----');
    const tray = Math.min(TRAY.depth - 0.1, m.dripTrayMl / (2 * TRAY.x * (TRAY.z1 - TRAY.z0)));
    this.parts.drip.visible = tray > 0.01;
    this.parts.drip.scale.y = Math.max(0.001, tray);
    this.leds.tray.set(`${Math.round(m.dripTrayMl)} ml`, 'drip tray');

    // Switches: power is on while the simulator runs; brew and steam follow the panel toggles.
    this.rocker('power', true);
    this.rocker('brew', sim.brewSwitch);
    this.rocker('steam', sim.steamSwitch);
    this.groups.knob.rotation.x = p.wandOpen ? -Math.PI / 2 : 0;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Stretches a unit-height part (geometry spanning y 0..1) to cover y0..y1.
  private place(name: string, y0: number, y1: number, visible: boolean): void {
    const part = this.parts[name];
    part.visible = visible && y1 - y0 > 0.005;
    part.position.y = y0;
    part.scale.y = Math.max(0.001, y1 - y0);
  }

  private updateCup(level: number): void {
    if (Math.abs(level - this.cupLevel) < 0.002) return;
    this.cupLevel = level;
    const h = Math.max(0.001, level * (CUP.height - 0.15));
    const rAt = (y: number) => CUP.rBottom - 0.12 + ((CUP.rTop - CUP.rBottom) * y) / CUP.height;
    const coffee = this.parts.coffee;
    coffee.geometry.dispose();
    coffee.geometry = new THREE.CylinderGeometry(rAt(h + 0.12), rAt(0.12), h, 40);
    coffee.position.y = 0.12 + h / 2;
    coffee.visible = level > 0.003;
    const crema = this.parts.crema;
    crema.visible = coffee.visible;
    crema.position.y = 0.13 + h;
    crema.scale.setScalar(rAt(h + 0.12));
  }

  private rocker(name: string, on: boolean): void {
    const part = this.parts[`switch-${name}`];
    part.rotation.x = on ? -0.22 : 0.22;
    (part.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 0.9 : 0;
  }

  private static legend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'm3d-legend';
    for (const [name, color] of Object.entries(READING_COLORS)) {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = color;
      dot.style.boxShadow = `0 0 6px ${color}`;
      item.append(dot, name);
      legend.append(item);
    }
    return legend;
  }

  private static canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d')!);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private static stripeTexture(): THREE.Texture {
    const texture = Machine3DView.canvasTexture(64, 4, g => {
      g.fillStyle = 'rgba(255,255,255,1)';
      g.fillRect(0, 0, 40, 4);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(40, 0, 24, 4);
    });
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  private static nameTexture(): THREE.Texture {
    return Machine3DView.canvasTexture(400, 80, g => {
      g.fillStyle = '#1d1d1f';
      g.beginPath();
      g.roundRect(0, 0, 400, 80, 14);
      g.fill();
      g.fillStyle = '#d9dde2';
      g.font = '600 46px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GAGGIA', 200, 42);
    });
  }

  private static shadowTexture(): THREE.Texture {
    return Machine3DView.canvasTexture(256, 256, g => {
      const gradient = g.createRadialGradient(128, 128, 10, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(0,0,0,0.28)');
      gradient.addColorStop(0.45, 'rgba(0,0,0,0.12)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gradient;
      g.fillRect(0, 0, 256, 256);
    });
  }
}

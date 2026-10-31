// Browser entry: builds the panels, owns the real-time loop that drives the virtual clock.

import { Simulation } from '../host/Simulation.js';
import type { Basket, MachineParams } from '../physics/Machine.js';
import { MachineView } from './MachineView.js';
import { DisplayView } from './DisplayView.js';
import { LineChart } from './Charts.js';
import type { ChartSpec } from './Charts.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MODES = ['Standby', 'Brew', 'Steam', 'Water', 'Grind'];
const SYSTEM_STATES = ['Starting', 'Waiting for controller', 'Ready', 'Updating', 'Autotuning', 'Protocol mismatch', 'Error'];
const SPEEDS: [string, number][] = [
  ['Pause', 0],
  ['1×', 1],
  ['2×', 2],
  ['5×', 5],
  ['10×', 10],
  ['Max', 200],
];

let sim: Simulation | null = null;
let speed = 1;
let windowS = 0; // 0: the last shot
let seedProfiles: Record<string, string> = {};

function button(label: string, onClick: (b: HTMLButtonElement) => void, title = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', () => onClick(b));
  return b;
}

function toggle(label: string, get: () => boolean, set: (on: boolean) => void, title = ''): HTMLButtonElement {
  const b = button(label, () => {
    set(!get());
    b.classList.toggle('on', get());
  }, title);
  b.classList.toggle('on', get());
  return b;
}

function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = ''): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'slider';
  const l = document.createElement('label');
  l.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
  const out = document.createElement('output');
  const show = () => (out.textContent = `${Number(input.value).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}${unit}`);
  input.addEventListener('input', () => {
    set(Number(input.value));
    show();
  });
  show();
  row.append(l, input, out);
  return row;
}

function group(title: string, ...children: HTMLElement[]): HTMLDivElement {
  const g = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  g.append(h, ...children);
  return g;
}

function row(...children: HTMLElement[]): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'row';
  r.append(...children);
  return r;
}

function machineParam<K extends keyof MachineParams>(key: K): [() => MachineParams[K], (v: MachineParams[K]) => void] {
  return [() => sim!.machine.params[key], v => sim!.machine.setParams({ [key]: v } as Partial<MachineParams>)];
}

function buildControls(): void {
  const root = $('machine-controls');
  root.replaceChildren();
  const m = () => sim!.machine;
  const basket = document.createElement('select');
  for (const b of ['puck', 'empty', 'blind']) basket.append(new Option(b === 'puck' ? 'Portafilter + puck' : b === 'empty' ? 'No portafilter' : 'Blind basket', b));
  basket.value = m().params.basket;
  basket.addEventListener('change', () => m().setParams({ basket: basket.value as Basket }));
  const mains = document.createElement('select');
  mains.append(new Option('50 Hz mains', '50'), new Option('60 Hz mains', '60'));
  mains.value = String(m().params.mainsHz);
  mains.addEventListener('change', () => m().setParams({ mainsHz: Number(mains.value) as 50 | 60 }));

  root.append(
    group(
      'Switches',
      row(
        toggle('Brew switch', () => sim!.brewSwitch, v => (sim!.brewSwitch = v), 'Latching brew switch on the controller board'),
        toggle('Steam switch', () => sim!.steamSwitch, v => (sim!.steamSwitch = v)),
        toggle('Steam/water knob', ...machineParam('wandOpen')),
      ),
      row(
        button('New puck', () => m().newPuck()),
        button('Empty cup', () => m().emptyCup()),
        toggle('Cup on scale', ...machineParam('cupPresent')),
        button('Refill tank', () => m().refillTank()),
        button('Empty tray', () => (m().dripTrayMl = 0)),
      ),
      row(basket, mains),
    ),
    group(
      'Puck',
      slider('Dose', 12, 24, 0.5, ...machineParam('doseG'), ' g'),
      slider('Puck density', 0.6, 1.0, 0.01, ...machineParam('puckDensity'), ' g/ml'),
      slider('Grind size', 150, 500, 5, ...machineParam('grindUm'), ' µm'),
      slider('Erosion', 0, 1, 0.01, ...machineParam('erosion')),
      slider('Channeling', 0, 6, 0.1, ...machineParam('channelingPerMin'), '/min'),
      slider('Compaction n', 0.5, 1, 0.01, ...machineParam('puckExponent')),
    ),
    group(
      'Machine',
      slider('OPV opens at', 6, 15, 0.5, ...machineParam('opvBar'), ' bar'),
      slider('Pump vs model', 0.7, 1.3, 0.01, ...machineParam('pumpMismatch'), '×'),
      slider('Headspace', 2, 20, 1, ...machineParam('headspaceMl'), ' ml'),
      slider('Inlet check valve', 0, 2, 0.1, ...machineParam('checkValveCrackBar'), ' bar'),
      slider('Ambient', 10, 35, 1, ...machineParam('ambientC'), ' °C'),
    ),
    group(
      'Scale & radio',
      row(
        toggle('BLE scale', () => sim!.scale.params.connected, v => (sim!.scale.params.connected = v)),
        toggle('Drop BLE link', () => sim!.link.params.forcedDown, v => sim!.link.setForcedDown(v)),
      ),
      slider('Scale latency', 0, 500, 10, () => sim!.scale.params.latencyMs, v => (sim!.scale.params.latencyMs = v), ' ms'),
      slider('Link loss', 0, 0.3, 0.01, () => sim!.link.params.lossRate, v => (sim!.link.params.lossRate = v)),
    ),
  );
}

const CHARTS: ChartSpec[] = [
  {
    title: 'Pressure & flow',
    left: { label: 'bar', min: 0 },
    right: { label: 'ml/s', min: 0 },
    series: [
      { key: 'pressure', label: 'pressure', color: 'var(--s1)' },
      { key: 'sensorPressure', label: 'firmware pressure', color: 'var(--s1)', dashed: true },
      { key: 'targetPressure', label: 'target pressure', color: 'var(--s6)', dashed: true },
      { key: 'pumpFlow', label: 'pump flow', color: 'var(--s2)', axis: 'right' },
      { key: 'pumpFlowModel', label: 'firmware pump flow', color: 'var(--s2)', axis: 'right', dashed: true },
      { key: 'cupFlow', label: 'flow into cup', color: 'var(--s3)', axis: 'right' },
      { key: 'puckFlowModel', label: 'firmware puck flow', color: 'var(--s3)', axis: 'right', dashed: true },
    ],
  },
  {
    title: 'Weight & water',
    left: { label: 'g', min: 0 },
    right: { label: 'ml', min: 0 },
    series: [
      { key: 'cupMl', label: 'in cup', color: 'var(--s3)' },
      { key: 'scale', label: 'BLE scale', color: 'var(--s1)' },
      { key: 'coffeeVolumeModel', label: 'firmware virtual scale', color: 'var(--s4)', dashed: true },
      { key: 'pumpedPhysical', label: 'water pumped', color: 'var(--s2)', axis: 'right' },
      { key: 'pumpedModel', label: 'firmware water pumped', color: 'var(--s2)', axis: 'right', dashed: true },
    ],
  },
  {
    title: 'Temperature & heater',
    left: { label: '°C' },
    right: { label: '%', min: 0, max: 100 },
    series: [
      { key: 'thermocoupleC', label: 'thermocouple', color: 'var(--s2)' },
      { key: 'waterC', label: 'boiler water', color: 'var(--s1)' },
      { key: 'brewWaterC', label: 'water at puck', color: 'var(--s3)' },
      { key: 'targetC', label: 'target', color: 'var(--s4)', dashed: true },
      { key: 'heaterDuty', label: 'heater duty', color: 'var(--s5)', axis: 'right' },
    ],
  },
];
const charts = CHARTS.map(spec => new LineChart(spec));

function buildTabs(): void {
  const tabs = $('tabs');
  const panes: Record<string, HTMLElement> = { Charts: $('tab-charts'), Internals: $('tab-internals'), 'Serial logs': $('tab-logs') };
  const buttons: HTMLButtonElement[] = [];
  for (const name of Object.keys(panes)) {
    const b = button(name, () => {
      for (const [n, pane] of Object.entries(panes)) pane.hidden = n !== name;
      buttons.forEach(x => x.classList.toggle('on', x === b));
    });
    buttons.push(b);
    tabs.append(b);
  }
  buttons[0].classList.add('on');
  const win = document.createElement('select');
  for (const [label, s] of [['Last shot', 0], ['60 s', 60], ['3 min', 180], ['10 min', 600]] as const) win.append(new Option(label, String(s)));
  win.addEventListener('change', () => (windowS = Number(win.value)));
  tabs.append(win);
  $('tab-charts').append(...charts.map(c => c.root));
}

function buildSpeed(): void {
  const seg = $('speed');
  const buttons = SPEEDS.map(([label, s]) =>
    button(label, b => {
      speed = s;
      buttons.forEach(x => x.classList.toggle('on', x === b));
    }),
  );
  buttons[1].classList.add('on');
  seg.append(...buttons);
}

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');

function kpi(label: string, value: string, sub = ''): string {
  return `<div class="kpi"><div class="k">${label}</div><div class="v">${value}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
}

function renderKpis(): void {
  if (!sim) return;
  const d = sim.displayState();
  const c = sim.controllerState();
  const last = sim.samples.at(-1); // flows averaged over the sample, not mid-stroke
  const brewing = d.processActive === 1 && d.processType === 1;
  const shotTime = Number.isFinite(d.brewElapsedMs) ? `${(d.brewElapsedMs / 1000).toFixed(1)} s` : '–';
  $('kpis').innerHTML = [
    kpi('Mode', MODES[d.mode] ?? '?', SYSTEM_STATES[d.systemState] ?? ''),
    kpi('Profile', sim.displayProfileName() || '–'),
    kpi('Phase', brewing ? sim.displayPhaseName() : '–', brewing ? `${d.brewPhaseIndex + 1}/${d.brewPhaseCount}` : ''),
    kpi('Shot time', shotTime),
    kpi('Scale', `${fmt(sim.scale.lastReading)} g`, Number.isFinite(d.brewTargetVolume) && d.brewTargetVolume > 0 ? `→ ${fmt(d.brewTargetVolume, 0)} g` : ''),
    kpi('Boiler', `${fmt(d.currentTemp)} °C`, `→ ${fmt(d.targetTemp, 0)}`),
    kpi('Pressure', `${fmt(d.pressure)} bar`, d.targetPressure > 0 ? `→ ${fmt(d.targetPressure)}` : ''),
    kpi('Pump flow', `${fmt(last?.pumpFlow ?? 0)} ml/s`, `fw ${fmt(d.pumpFlow)}`),
    kpi('Into cup', `${fmt(last?.cupFlow ?? 0)} ml/s`, `fw ${fmt(d.puckFlow)}`),
    kpi('Water pumped', `${fmt(c.pumpPumpedWater, 0)} ml`, 'firmware'),
    kpi('Link', d.connected ? 'connected' : 'down', `${sim.link.intervalMs()} ms · ${sim.link.stats.delivered} frames`),
    kpi('Brew delay', `${fmt(d.brewDelay, 0)} ms`, 'learned'),
  ].join('');
}

function table(title: string, rows: [string, string][]): string {
  return `<div><h2>${title}</h2><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table></div>`;
}

function renderInternals(): void {
  if (!sim || $('tab-internals').hidden) return;
  const c = sim.controllerState();
  const d = sim.displayState();
  const m = sim.machine;
  const nums = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => [k, fmt(v, 3)] as [string, string]);
  $('tab-internals').innerHTML = [
    table('Controller firmware', nums(c)),
    table('Display firmware', nums(d)),
    table('Physics', [
      ['node pressure (bar)', fmt(m.pressure, 3)],
      ['pump flow (ml/s)', fmt(m.qPump, 3)],
      ['OPV flow (ml/s)', fmt(m.qOpv, 3)],
      ['group flow (ml/s)', fmt(m.qGroup, 3)],
      ['flow into cup (ml/s)', fmt(m.qCup, 3)],
      ['headspace (ml)', fmt(m.headspaceMl, 2)],
      ['puck saturation', fmt(m.puck.saturation(), 3)],
      ['puck resistance', fmt(m.puck.resistance(), 3)],
      ['puck base resistance', fmt(m.puck.baseResistance(), 3)],
      ['puck height (mm)', fmt(m.puck.heightMm(), 2)],
      ['puck porosity', fmt(m.puck.porosity(), 3)],
      ['puck out (ml)', fmt(m.puck.outMl, 2)],
      ['boiler metal (°C)', fmt(m.metalC, 2)],
      ['boiler water (°C)', fmt(m.waterC, 2)],
      ['group (°C)', fmt(m.groupC, 2)],
      ['water at puck (°C)', fmt(m.brewWaterC, 2)],
      ['pumped total (ml)', fmt(m.pumpedMl, 1)],
      ['tank (ml)', fmt(m.tankMl, 0)],
    ]),
    table('BLE link', [
      ['connected', String(sim.link.connected)],
      ['interval (ms)', String(sim.link.intervalMs())],
      ['datagrams sent', String(sim.link.stats.sent)],
      ['delivered', String(sim.link.stats.delivered)],
      ['lost', String(sim.link.stats.lost)],
      ['bytes', String(sim.link.stats.bytes)],
    ]),
  ].join('');
}

let logDirty = { controller: true, display: true };
function renderLogs(): void {
  if (!sim || $('tab-logs').hidden) return;
  for (const side of ['controller', 'display'] as const) {
    if (!logDirty[side]) continue;
    logDirty[side] = false;
    const pre = $(`log-${side}`);
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    pre.textContent = sim.logs[side].map(l => l.text).join('\n');
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
}

// The last shot grows from its start while it runs and freezes once it ends; before the first shot,
// or with a time window picked, the charts scroll with the clock.
function drawCharts(sim: Simulation): void {
  const shot = sim.shots.at(-1);
  const now = sim.nowMs / 1000;
  if (windowS === 0 && shot) {
    const end = shot.endS === null ? Math.max(now, shot.startS + 30) : shot.endS + 8;
    charts.forEach(ch => ch.draw(shot.samples, shot.startS - 3, end, shot.startS));
  } else {
    charts.forEach(ch => ch.draw(sim.samples, now - (windowS || 60), now));
  }
}

async function boot(): Promise<void> {
  const next = new Simulation({ seed: 1 + Math.floor(Math.random() * 1e6), seedProfiles });
  await next.start();
  next.onLog = side => (logDirty[side] = true);
  sim = next;
  displayView.reset();
  buildControls();
}

const machineView = new MachineView($('machine-view'));
const displayView = new DisplayView($('display') as HTMLCanvasElement, () => sim);

async function main(): Promise<void> {
  buildSpeed();
  buildTabs();
  $('reset').addEventListener('click', () => void boot());
  seedProfiles = await (await fetch(new URL('../../wasm/seed-profiles.json', import.meta.url))).json();
  await boot();
  let last = performance.now();
  let slowTick = 0;
  const frame = (now: number) => {
    // Background tabs throttle rAF to ~1 Hz; catch up on up to a second of real time per frame.
    const real = Math.min(1000, now - last);
    last = now;
    if (sim && speed > 0) {
      const budgetEnd = performance.now() + 40;
      // A finger on the screen runs at device speed, so taps and holds mean what they would on the machine.
      let todo = real * (displayView.pressed ? Math.min(speed, 1) : speed);
      while (todo >= 1 && performance.now() < budgetEnd) {
        const chunk = Math.min(10, Math.floor(todo));
        sim.run(chunk);
        todo -= chunk;
      }
    }
    if (sim) {
      displayView.draw();
      machineView.update(sim);
      $('clock').textContent = `t = ${(sim.nowMs / 1000).toFixed(1)} s`;
      if (now - slowTick > 200) {
        slowTick = now;
        renderKpis();
        renderInternals();
        renderLogs();
        if (!$('tab-charts').hidden) drawCharts(sim);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();

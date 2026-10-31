// End-to-end checks: both firmware modules (wasm/*.wasm) against the TypeScript machine model.
// Needs `npm run build` (or wasm/build.sh) first. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Simulation } from '../dist/src/host/Simulation.js';

const MODE_BREW = 1;
const READY = 2;
const EXIT_TARGET_VOLUMETRIC = 1;

const dataDir = new URL('../../data/p/', import.meta.url);
const seedProfiles = Object.fromEntries(fs.readdirSync(dataDir).map(f => [f, fs.readFileSync(new URL(f, dataDir), 'utf8')]));

async function boot(machine = {}) {
  const sim = new Simulation({ seed: 7, seedProfiles, machine });
  await sim.start();
  sim.run(12000);
  return sim;
}

// Flips the latching brew switch to wake from standby, heats, then pulls one shot of the selected
// (Default, volumetric 36 g) profile and returns the display's state as the shot finished.
async function pullShot(machine = {}) {
  const sim = await boot(machine);
  sim.brewSwitch = true;
  sim.run(800);
  sim.brewSwitch = false;
  sim.run(240000);
  const heated = sim.displayState();
  sim.machine.emptyCup();
  sim.brewSwitch = true;
  let finished = null;
  for (let i = 0; i < 1200 && !finished; i++) {
    sim.run(100);
    const d = sim.displayState();
    if (i > 20 && !d.processActive) finished = d;
  }
  sim.run(4000); // drip-out
  const shot = sim.shots.at(-1);
  sim.brewSwitch = false;
  sim.run(500);
  return { sim, heated, finished, shot };
}

test('controller and display boot, detect the board and connect over the link', async () => {
  const sim = await boot();
  const d = sim.displayState();
  assert.equal(d.systemState, READY);
  assert.equal(d.connected, 1);
  assert.ok(sim.link.stats.delivered > 10);
  assert.ok(sim.logs.controller.some(l => /Pro Rev 1\.1/i.test(l.text)), 'board autodetect logged');
});

// Runs virtual time until `promise` settles: the display serves web requests from its loop task.
async function serve(sim, promise, maxMs = 2000) {
  let result = null;
  promise.then(v => (result = { v }), e => (result = { e }));
  for (let t = 0; t < maxMs && !result; t += 20) {
    sim.run(20);
    await null;
  }
  assert.ok(result, 'no answer from the display');
  if (result.e) throw result.e;
  return result.v;
}

test('the web UI API and socket reach the display firmware web server', async () => {
  const sim = await boot();
  const res = await serve(sim, sim.web.request({ method: 'GET', url: '/api/settings' }));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /json/);
  assert.equal(JSON.parse(new TextDecoder().decode(res.body)).startupMode, 'standby');

  const messages = [];
  let closed = false;
  const opened = new Promise(resolve => {
    const ws = sim.web.openSocket('/ws', { open: () => resolve(ws), message: m => messages.push(JSON.parse(m)), close: () => (closed = true) });
  });
  const ws = await serve(sim, opened);
  ws.send(JSON.stringify({ tp: 'req:profiles:list', rid: 'r1' }));
  sim.run(1500);
  assert.ok(messages.some(m => m.tp === 'evt:status'), 'status pushed to the socket');
  const list = messages.find(m => m.tp === 'res:profiles:list' && m.rid === 'r1');
  assert.ok(list?.profiles.length > 0, 'profile list answered');
  ws.close();
  sim.run(100);
  assert.ok(closed);
});

test('a Default shot heats to target and stops on the scale at 36 g', async () => {
  const { sim, heated, finished, shot } = await pullShot();
  assert.equal(heated.mode, MODE_BREW);
  assert.ok(Math.abs(heated.currentTemp - heated.targetTemp) < 1.5, `boiler ${heated.currentTemp} vs ${heated.targetTemp}`);

  assert.ok(finished, 'shot finished');
  assert.equal(finished.brewLastExitReason, EXIT_TARGET_VOLUMETRIC);
  assert.equal(finished.brewTargetVolume, 36);
  assert.ok(sim.scale.lastReading > 35 && sim.scale.lastReading < 39.5, `final weight ${sim.scale.lastReading}`);
  assert.ok(finished.brewElapsedMs > 15000 && finished.brewElapsedMs < 45000, `shot time ${finished.brewElapsedMs}`);

  // Full pump power against a puck: the OPV caps the pressure.
  const peak = Math.max(...shot.samples.map(s => s.pressure));
  assert.ok(peak > 9 && peak < sim.machine.params.opvBar + 1.5, `peak ${peak} bar`);
  // The firmware's filtered sensor reading follows the physical pressure.
  const mid = shot.samples.find(s => s.t > shot.startS + 10);
  assert.ok(Math.abs(mid.sensorPressure - mid.pressure) < 0.5, `sensor ${mid.sensorPressure} vs ${mid.pressure}`);
  assert.ok(shot.endS !== null && shot.endS > shot.startS);
});

test('a denser puck slows the shot down', async () => {
  const loose = await pullShot({ puckDensity: 0.7 });
  const dense = await pullShot({ puckDensity: 0.9 });
  assert.ok(dense.finished.brewElapsedMs > loose.finished.brewElapsedMs * 1.3,
    `dense ${dense.finished.brewElapsedMs} ms vs loose ${loose.finished.brewElapsedMs} ms`);
});

test('puck erosion raises flow at constant pressure over the shot', async () => {
  const { shot } = await pullShot({ erosion: 0.5 });
  const at = s => shot.samples.find(x => x.t >= shot.startS + s);
  const early = at(10);
  const late = at(Math.min(18, (shot.endS - shot.startS) - 1));
  assert.ok(late.puckResistance < early.puckResistance, `resistance ${early.puckResistance} -> ${late.puckResistance}`);
  assert.ok(late.cupFlow > early.cupFlow, `cup flow ${early.cupFlow} -> ${late.cupFlow}`);
});

// Headless end-to-end shot: both firmware modules + physics, printed as a table.
// Usage: node scripts/shot.mjs   (env: DENSITY, EROSION, HEAT_S, LOGS=<lines>)
import fs from 'node:fs';
import path from 'node:path';
import { Simulation } from '../dist/src/host/Simulation.js';

const dataDir = new URL('../../data/p/', import.meta.url);
const seedProfiles = Object.fromEntries(fs.readdirSync(dataDir).map(f => [f, fs.readFileSync(new URL(f, dataDir), 'utf8')]));
const sim = new Simulation({ seed: 7, seedProfiles, machine: { puckDensity: +(process.env.DENSITY || 0.8), erosion: +(process.env.EROSION ?? 0.25) } });
await sim.start();
const t0 = performance.now();
const flip = (on, ms) => { sim.brewSwitch = on; sim.run(ms); };
sim.run(12000);
flip(true, 800); flip(false, 800); // wake from standby
sim.run(+(process.env.HEAT_S || 150) * 1000);
const d0 = sim.displayState();
console.log(`heated: mode=${d0.mode} temp=${d0.currentTemp.toFixed(1)}/${d0.targetTemp} boiler=${sim.machine.waterC.toFixed(1)} profile=${sim.displayProfileName()}`);
sim.machine.emptyCup();
const shotStart = sim.samples.length;
flip(true, 0);
let ended = 0;
for (let i = 0; i < 600; i++) {
  sim.run(100);
  const d = sim.displayState();
  if (i > 20 && !d.processActive) { if (!ended) ended = sim.nowMs; if (sim.nowMs - ended > 4000) break; }
}
const d = sim.displayState(); // before releasing the switch, which clears the finished process
sim.brewSwitch = false; sim.run(1000);
const shot = sim.samples.slice(shotStart).filter((_, i) => i % 10 === 0);
const f = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '-').padStart(6);
console.log('   t     P  Psens  Ptgt  Qpump Qmodel  Qcup Qpuck*  cup  scale  pump*  pumped  T_tc  T_brew duty%  R      R*');
for (const s of shot) console.log([s.t, s.pressure, s.sensorPressure, s.targetPressure, s.pumpFlow, s.pumpFlowModel, s.cupFlow, s.puckFlowModel, s.cupMl, s.scale, s.pumpedModel, s.pumpedPhysical, s.thermocoupleC, s.brewWaterC, s.heaterDuty, s.puckResistance, s.puckResistanceModel].map(v => f(v)).join(''));
console.log(`shot: ${d.brewElapsedMs / 1000}s phase=${sim.displayPhaseName()} exit=${d.brewLastExitReason} target=${d.brewTargetVolume}g scaleFinal=${sim.scale.lastReading.toFixed(1)} cup=${sim.machine.cupMl.toFixed(1)}ml brewDelay=${d.brewDelay}`);
console.log(`real time ${((performance.now() - t0) / 1000).toFixed(1)}s for ${(sim.nowMs / 1000).toFixed(0)}s simulated`);
if (process.env.LOGS) for (const side of ['controller', 'display']) console.log(`--- ${side}\n` + sim.logs[side].filter(l => !/PID Plot|SPS ch0/.test(l.text)).slice(-+process.env.LOGS).map(l => l.text).join('\n'));

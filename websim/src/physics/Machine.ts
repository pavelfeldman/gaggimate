// Physical model of a Gaggia Classic Pro with a GaggiMate Pro board: mains, vibratory pump, one
// hydraulic node (pump outlet, boiler, lines) with OPV, 3-way valve, group headspace, puck, cup,
// drip tray and tank; boiler metal/water and group-head thermal nodes; the sensors the firmware
// reads. Stepped at a fixed 1 ms by the host. New code — not part of the firmware port.

import { Random } from '../platform/random.js';

export type Basket = 'puck' | 'empty' | 'blind';

export interface MachineParams {
  mainsHz: 50 | 60;
  ambientC: number;
  // Pump (the real one; the firmware has its own calibrated model of it)
  pumpFlowAt1Bar: number; // ml/s at full drive
  pumpFlowAt9Bar: number;
  pumpMismatch: number; // multiplies the real pump curve against the firmware's calibration
  // Hydraulics
  opvBar: number;
  opvConductance: number; // ml/s per bar above opvBar
  complianceRigid: number; // ml/bar (hoses, boiler walls)
  airPocketMl: number; // trapped air at 1 bar abs; adds V/(P+1)^2 compliance
  valveResistance: number; // bar·s/ml through the 3-way valve + shower screen
  headspaceMl: number;
  wandResistance: number; // bar·s/ml when the steam/water knob is open
  checkValveCrackBar: number; // boiler inlet check valve; the sensor sits upstream of it
  // Thermal
  heaterW: number;
  boilerMetalJPerK: number;
  boilerWaterMl: number;
  metalWaterWPerK: number;
  boilerLossWPerK: number;
  groupJPerK: number;
  boilerGroupWPerK: number;
  groupLossWPerK: number;
  thermocoupleLagS: number;
  // Sensors
  pressureSensorRatingBar: number; // 0.5–4.5 V spans 0..rating
  pressureNoiseBar: number;
  // Puck
  basket: Basket;
  doseG: number;
  puckDensity: number; // g/ml bulk (tamped)
  grindUm: number; // median particle size
  basketDiameterMm: number;
  absorptionMlPerG: number; // water retained before the first drip
  erosion: number; // fractional conductance gain per ml/g extracted
  channelingPerMin: number; // random channel events per minute above 4 bar
  channelingDrop: number; // resistance drop per channel event
  puckExponent: number; // Q ∝ P^n (compaction makes n < 1)
  // Operator
  wandOpen: boolean;
  cupPresent: boolean;
  tankCapacityMl: number;
}

export const DEFAULT_PARAMS: MachineParams = {
  mainsHz: 50,
  ambientC: 22,
  pumpFlowAt1Bar: 10.205,
  pumpFlowAt9Bar: 5.521,
  pumpMismatch: 1.0,
  opvBar: 11,
  opvConductance: 3,
  complianceRigid: 0.25,
  airPocketMl: 2.0,
  valveResistance: 0.08,
  headspaceMl: 8,
  wandResistance: 0.35,
  checkValveCrackBar: 0,
  heaterW: 1370,
  boilerMetalJPerK: 600,
  boilerWaterMl: 100,
  metalWaterWPerK: 100,
  boilerLossWPerK: 0.6,
  groupJPerK: 800,
  boilerGroupWPerK: 12,
  groupLossWPerK: 1.2,
  thermocoupleLagS: 2,
  pressureSensorRatingBar: 16,
  pressureNoiseBar: 0.02,
  basket: 'puck',
  doseG: 18,
  puckDensity: 0.8,
  grindUm: 300,
  basketDiameterMm: 58,
  absorptionMlPerG: 1.1,
  erosion: 0.25,
  channelingPerMin: 0,
  channelingDrop: 0.15,
  puckExponent: 0.85,
  wandOpen: false,
  cupPresent: true,
  tankCapacityMl: 2100,
};

const WATER_C = 4.18; // J/(g·K)
const SOLID_DENSITY = 1.3; // g/ml, coffee particles
const REF = { density: 0.8, grindUm: 300, doseG: 18, basketMm: 58, resistance: 3.25 }; // ≈2 ml/s at 9 bar on a wet puck

// Water dynamic viscosity (Pa·s), Vogel equation.
const viscosity = (tC: number): number => 2.414e-5 * Math.pow(10, 247.8 / (tC + 133.15));
const kozenyCarman = (porosity: number): number => (porosity ** 3) / ((1 - porosity) ** 2);
// Saturation vapour pressure of water, gauge bar (Antoine, valid ~100–150 °C).
const steamGaugeBar = (tC: number): number => Math.max(0, Math.pow(10, 8.14019 - 1810.94 / (244.485 + tC)) / 750.06 - 1.01325);

export class Puck {
  absorbedMl = 0;
  outMl = 0; // liquid that left the bottom of the basket
  channelFactor = 1;
  constructor(readonly params: MachineParams) {}

  capacityMl(): number {
    return this.params.doseG * this.params.absorptionMlPerG;
  }

  saturation(): number {
    return Math.min(1, this.absorbedMl / this.capacityMl());
  }

  heightMm(): number {
    const area = Math.PI * (this.params.basketDiameterMm / 20) ** 2; // cm²
    return (this.params.doseG / this.params.puckDensity / area) * 10;
  }

  porosity(): number {
    return Math.min(0.85, Math.max(0.05, 1 - this.params.puckDensity / SOLID_DENSITY));
  }

  // Wet-puck resistance at 93 °C before erosion (bar^n·s/ml), from Kozeny–Carman scaling.
  baseResistance(): number {
    const p = this.params;
    const ref = new Puck({ ...p, puckDensity: REF.density, grindUm: REF.grindUm, doseG: REF.doseG, basketDiameterMm: REF.basketMm });
    const height = this.heightMm() / ref.heightMm();
    const perm = kozenyCarman(this.porosity()) / kozenyCarman(ref.porosity());
    const grind = (p.grindUm / REF.grindUm) ** 2;
    return (REF.resistance * height) / (perm * grind);
  }

  resistance(): number {
    const swelling = 0.35 + 0.65 * this.saturation(); // dry grounds pass water easily, then swell
    const erosion = 1 + (this.params.erosion * this.outMl) / this.params.doseG;
    return (this.baseResistance() * swelling) / erosion / this.channelFactor;
  }

  // Water entering the puck at headspace pressure p (bar) and brew water temperature t (°C).
  inflow(p: number, t: number): number {
    if (p <= 0) return 0;
    return (Math.pow(p, this.params.puckExponent) / this.resistance()) * (viscosity(93) / viscosity(t));
  }

  // Splits inflow into absorption and drip; returns ml leaving the basket.
  pass(inMl: number): number {
    const s = this.saturation();
    const drip = s < 0.75 ? 0 : s >= 1 ? 1 : ((s - 0.75) / 0.25) ** 2;
    const absorbed = Math.min(inMl * (1 - drip), this.capacityMl() - this.absorbedMl);
    this.absorbedMl += absorbed;
    const out = inMl - absorbed;
    this.outMl += out;
    return out;
  }
}

export interface MachineOutputs {
  heater: boolean; // SSR pin
  pump: boolean; // PSM-driven SSR pin
  valve: boolean; // 3-way solenoid
}

export class Machine {
  params: MachineParams;
  readonly random: Random;
  puck: Puck;

  // Hydraulics
  pressure = 0; // node gauge pressure (bar)
  headspaceMl = 0;
  tankMl = 1800;
  cupMl = 0;
  dripTrayMl = 0;
  postDripMlPerS = 0;
  pumpStrokeLatched = false;
  halfCycle = 0;
  // Flows of the last step (ml/s)
  qPump = 0;
  qOpv = 0;
  qGroup = 0;
  qCup = 0;
  qWand = 0;
  // Totals (ml)
  pumpedMl = 0; // physical water the pump moved
  // Thermal
  metalC: number;
  waterC: number;
  groupC: number;
  thermocoupleC: number;
  brewWaterC: number;
  heaterOn = false;
  heaterOnMs = 0;

  constructor(params: Partial<MachineParams> = {}, seed = 1) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.random = new Random(seed);
    this.puck = new Puck(this.params);
    const t = this.params.ambientC;
    this.metalC = this.waterC = this.groupC = this.thermocoupleC = this.brewWaterC = t;
  }

  setParams(changes: Partial<MachineParams>): void {
    Object.assign(this.params, changes);
  }

  newPuck(): void {
    this.puck = new Puck(this.params);
    this.headspaceMl = 0;
    this.postDripMlPerS = 0;
  }

  emptyCup(): void {
    this.cupMl = 0;
  }

  refillTank(): void {
    this.tankMl = this.params.tankCapacityMl;
  }

  // Zero crossings per second seen by the controller's sense pin (both edges of the mains cycle).
  zeroCrossIntervalMs(): number {
    return 1000 / (2 * this.params.mainsHz);
  }

  // Full-drive pump flow at node pressure p (ml/s): the real pump, before stroke shaping.
  pumpCurve(p: number): number {
    const { pumpFlowAt1Bar: q1, pumpFlowAt9Bar: q9, pumpMismatch } = this.params;
    const slope = (q9 - q1) / 8;
    return Math.max(0, (q1 + slope * (p - 1)) * pumpMismatch);
  }

  compliance(p: number): number {
    return this.params.complianceRigid + this.params.airPocketMl / (Math.max(0, p) + 1) ** 2;
  }

  // Called at each mains zero crossing after the firmware's ISR ran: a vibratory pump strokes on
  // the positive half-cycle when its SSR conducts.
  onZeroCross(pumpPin: boolean): void {
    this.halfCycle++;
    this.pumpStrokeLatched = this.halfCycle % 2 === 0 && pumpPin;
  }

  step(dt: number, out: MachineOutputs, tMs: number): void {
    const p = this.params;
    // --- pump: half-sine stroke over the positive half-cycle ---
    const halfMs = this.zeroCrossIntervalMs();
    const phase = (tMs % halfMs) / halfMs;
    const tankOk = this.tankMl > 30;
    const strokePeak = (Math.PI / 2) * 2 * this.pumpCurve(this.pressure); // mean over a full cycle = curve
    this.qPump = this.pumpStrokeLatched && tankOk ? strokePeak * Math.sin(Math.PI * phase) : 0;

    // --- outflows from the node ---
    this.qOpv = Math.max(0, this.pressure - p.opvBar) * p.opvConductance;
    this.qWand = p.wandOpen ? Math.max(0, this.pressure) / p.wandResistance : 0;
    this.qGroup = 0;
    this.qCup = 0;
    if (out.valve) {
      if (p.basket === 'empty') {
        this.qGroup = Math.max(0, this.pressure) / (p.valveResistance * 2);
        this.dripTrayMl += this.qGroup * dt;
      } else if (p.basket === 'blind') {
        this.qGroup = 0;
      } else if (this.headspaceMl < p.headspaceMl) {
        // Filling the headspace: little back pressure until it's full
        this.qGroup = Math.max(0, this.pressure) / p.valveResistance;
        this.headspaceMl = Math.min(p.headspaceMl, this.headspaceMl + this.qGroup * dt);
        // the dry puck takes some water from the start
        const wet = this.puck.inflow(Math.max(0.2, this.pressure), this.brewWaterC) * dt * 0.3;
        this.qCup = this.puck.pass(wet) / dt;
      } else {
        this.qGroup = this.puck.inflow(this.pressure, this.brewWaterC);
        this.qCup = this.puck.pass(this.qGroup * dt) / dt;
      }
      this.postDripMlPerS = this.qCup;
      if (this.qCup > 0 && this.pressure > 4 && p.channelingPerMin > 0 && this.random.next() < (p.channelingPerMin / 60000) * dt * 1000) {
        this.puck.channelFactor *= 1 / (1 - p.channelingDrop);
      }
    } else {
      // 3-way valve dumps the group: headspace water to the drip tray, the puck keeps dripping briefly
      if (this.headspaceMl > 0) {
        const dump = Math.min(this.headspaceMl, 25 * dt);
        this.headspaceMl -= dump;
        this.dripTrayMl += dump;
      }
      this.qCup = this.postDripMlPerS;
      this.puck.outMl += this.qCup * dt;
      this.postDripMlPerS *= Math.exp(-dt / 0.8);
      if (this.postDripMlPerS < 0.005) this.postDripMlPerS = 0;
    }
    if (p.cupPresent) this.cupMl += this.qCup * dt;
    else this.dripTrayMl += this.qCup * dt;

    // --- node pressure ---
    const net = this.qPump - this.qOpv - this.qGroup - this.qWand;
    this.pressure += (net / this.compliance(this.pressure)) * dt;
    // A sealed boiler above 100 °C holds at least its steam pressure.
    if (!out.valve) this.pressure = Math.max(this.pressure, steamGaugeBar(this.waterC));
    if (this.pressure < 0) this.pressure = 0;

    // --- water accounting ---
    this.pumpedMl += this.qPump * dt;
    this.tankMl += (this.qOpv - this.qPump) * dt;

    // --- thermal ---
    this.heaterOn = out.heater;
    if (out.heater) this.heaterOnMs += dt * 1000;
    const throughFlow = this.qGroup + this.qWand; // water leaving the boiler, replaced from the tank
    const heater = out.heater ? p.heaterW : 0;
    const qMetalWater = p.metalWaterWPerK * (this.metalC - this.waterC);
    const qMetalGroup = p.boilerGroupWPerK * (this.metalC - this.groupC);
    const qMetalLoss = p.boilerLossWPerK * (this.metalC - p.ambientC);
    this.metalC += ((heater - qMetalWater - qMetalGroup - qMetalLoss) / p.boilerMetalJPerK) * dt;
    const waterCap = p.boilerWaterMl * WATER_C;
    this.waterC += ((qMetalWater - throughFlow * WATER_C * (this.waterC - p.ambientC)) / waterCap) * dt;
    this.brewWaterC = this.waterC - 0.35 * (this.waterC - this.groupC);
    const qGroupWater = this.qGroup * WATER_C * (this.waterC - this.brewWaterC);
    this.groupC += ((qMetalGroup + qGroupWater - p.groupLossWPerK * (this.groupC - p.ambientC)) / p.groupJPerK) * dt;
    this.thermocoupleC += ((this.metalC - this.thermocoupleC) * dt) / p.thermocoupleLagS;
  }

  // --- sensors (what the firmware's drivers read) ---

  // Pressure transducer on the pump outlet: 0.5–4.5 V over 0..rating, into the ADS1115.
  pressureSensorVolts(): number {
    const p = this.pressure + (this.qPump > 0 ? this.params.checkValveCrackBar : 0) + this.random.gaussian() * this.params.pressureNoiseBar;
    return 0.5 + (4.0 * Math.max(0, p)) / this.params.pressureSensorRatingBar;
  }

  thermocouple(): number {
    return this.thermocoupleC + this.random.gaussian() * 0.05;
  }
}

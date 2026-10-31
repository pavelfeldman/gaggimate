// Owns the virtual clock and wires the two firmware modules to the machine model, the BLE link
// and the scale. Each 1 ms tick: firmware runs up to t, the mains zero crossing fires the
// controller's PSM interrupt, physics advances one step using the pins the firmware drives, then
// the radio and the scale deliver whatever is due.

import { Random } from '../platform/random.js';
import { Machine } from '../physics/Machine.js';
import type { MachineParams } from '../physics/Machine.js';
import { Scale } from '../physics/Scale.js';
import type { ScaleParams } from '../physics/Scale.js';
import { BleLink } from './BleLink.js';
import type { LinkParams, Side } from './BleLink.js';
import { loadModule, deliver, Inspector } from './WasmBoard.js';
import type { ControllerModule, DisplayModule, GmHost, LogLine } from './WasmBoard.js';

// GaggiMate Pro Rev 1.1 pins (lib/GaggiMateController/src/ControllerConfig.h)
export const PIN = { HEATER: 14, PUMP: 9, PUMP_SENSE: 21, VALVE: 10, ALT: 47, BREW_BTN: 38, STEAM_BTN: 48, DETECT: 11 } as const;
const BOARD_DETECT_MV = 450; // autodetect value 4 -> Pro Rev 1.1
const LOG_LIMIT = 600;

export interface Sample {
  t: number; // s
  pressure: number; // physical node pressure (bar)
  sensorPressure: number; // controller's filtered reading
  targetPressure: number;
  pumpFlow: number; // physical, averaged over the sample
  pumpFlowModel: number; // firmware's model
  targetFlow: number;
  cupFlow: number; // physical flow into the cup
  puckFlowModel: number; // firmware's puck-flow estimate
  cupMl: number;
  scale: number;
  coffeeVolumeModel: number; // firmware's virtual-scale estimate
  pumpedPhysical: number; // since the firmware's last tare
  pumpedModel: number;
  waterC: number;
  thermocoupleC: number;
  brewWaterC: number;
  groupC: number;
  targetC: number;
  heaterDuty: number; // %
  pumpPower: number; // %
  puckResistance: number; // physical (bar^n·s/ml)
  puckResistanceModel: number;
  phaseIndex: number;
}

/** One brew, from the display's process going active to it ending, with the samples around it. */
export interface Shot {
  startS: number;
  endS: number | null;
  samples: Sample[];
}

const SHOT_LEAD_S = 3; // samples kept before the shot starts
const SHOT_TAIL_S = 8; // and after it ends, for the drip-out

export interface SimulationOptions {
  seed?: number;
  machine?: Partial<MachineParams>;
  scale?: Partial<ScaleParams>;
  link?: Partial<LinkParams>;
  seedProfiles?: Record<string, string>; // filename -> JSON, written to the display's LittleFS /p
  sampleIntervalMs?: number;
}

export class Simulation {
  readonly random: Random;
  readonly machine: Machine;
  readonly scale: Scale;
  readonly link: BleLink;
  controller!: ControllerModule;
  display!: DisplayModule;
  controllerInspector!: Inspector<ControllerModule>;
  displayInspector!: Inspector<DisplayModule>;

  nowMs = 0;
  brewSwitch = false;
  steamSwitch = false;
  readonly logs: Record<Side, LogLine[]> = { controller: [], display: [] };
  readonly samples: Sample[] = [];
  readonly shots: Shot[] = [];
  sampleIntervalMs: number;
  onLog: ((side: Side, line: LogLine) => void) | null = null;

  private readonly pins: Record<Side, Map<number, number>> = { controller: new Map(), display: new Map() };
  private nextZeroCrossMs = 0;
  private nextSampleMs = 0;
  private acc = { pump: 0, cup: 0, n: 0 };
  private pumpedAtTare = 0;
  private lastModelPumped = 0;
  private touchPressedAt = 0;
  private pendingRelease: { x: number; y: number; at: number } | null = null;

  constructor(private readonly options: SimulationOptions = {}) {
    this.random = new Random(options.seed ?? 1);
    this.machine = new Machine(options.machine, (options.seed ?? 1) + 1);
    this.scale = new Scale(new Random((options.seed ?? 1) + 2), options.scale);
    this.link = new BleLink(new Random((options.seed ?? 1) + 3), options.link);
    this.sampleIntervalMs = options.sampleIntervalMs ?? 100;
  }

  async start(): Promise<void> {
    this.controller = await loadModule<ControllerModule>('controller', this.host('controller'));
    this.display = await loadModule<DisplayModule>('display', this.host('display'));
    this.link.attach('controller', { receive: b => deliver(this.controller, b), setState: s => this.controller._gm_link_state(s) });
    this.link.attach('display', { receive: b => deliver(this.display, b), setState: s => this.display._gm_link_state(s) });
    // A fresh flash: the filesystem image carries the seed profiles (data/p).
    const profiles = this.options.seedProfiles ?? {};
    if (Object.keys(profiles).length) {
      this.display.FS.mkdirTree('/sim_data/littlefs/p');
      for (const [name, json] of Object.entries(profiles)) this.display.FS.writeFile(`/sim_data/littlefs/p/${name}`, json);
    }
    this.display._gm_display_prepare();
    this.controllerInspector = new Inspector(this.controller, m => m._gm_inspect_controller_names(), m => m._gm_inspect_controller());
    this.displayInspector = new Inspector(this.display, m => m._gm_inspect_display_names(), m => m._gm_inspect_display());
    this.controller._gm_boot();
    this.display._gm_boot();
  }

  private host(side: Side): GmHost {
    const pins = this.pins[side];
    return {
      pinMode: () => {},
      digitalWrite: (pin, value) => void pins.set(pin, value),
      digitalRead: pin => this.readPin(side, pin),
      analogReadMilliVolts: pin => (side === 'controller' && pin === PIN.DETECT ? BOARD_DETECT_MV : 0),
      adcVolts: channel => (side === 'controller' && channel === 0 ? this.machine.pressureSensorVolts() : 0),
      thermocoupleC: () => this.machine.thermocouple(),
      random: () => Math.floor(this.random.next() * 2 ** 32),
      linkSend: bytes => this.link.send(side, bytes),
      linkRequest: request => this.link.request(side, request, this.nowMs),
      linkLowLatency: active => void (this.link.lowLatency = active),
      event: name => {
        if (name === 'scale:tare') this.scale.requestTare(this.nowMs);
      },
      log: (level, text) => this.pushLog(side, level, text),
    };
  }

  private readPin(side: Side, pin: number): number {
    if (side === 'controller') {
      if (pin === PIN.BREW_BTN) return this.brewSwitch ? 0 : 1; // switches pull to ground
      if (pin === PIN.STEAM_BTN) return this.steamSwitch ? 0 : 1;
    }
    return 1; // inputs idle high (pull-ups, absent HX711)
  }

  private pushLog(side: Side, level: string, text: string): void {
    const line = { tMs: this.nowMs, level, text };
    const list = this.logs[side];
    list.push(line);
    if (list.length > LOG_LIMIT) list.shift();
    this.onLog?.(side, line);
  }

  pin(side: Side, pin: number): boolean {
    return (this.pins[side].get(pin) ?? 0) !== 0;
  }

  // LVGL samples the pointer every UI loop (25 ms); a press shorter than a couple of samples is
  // invisible to it, so releases are held back until the press lasted MIN_PRESS_MS of virtual time.
  touch(x: number, y: number, pressed: boolean): void {
    const MIN_PRESS_MS = 60;
    if (pressed) {
      this.touchPressedAt = this.nowMs;
      this.pendingRelease = null;
      this.display._gm_touch(Math.round(x), Math.round(y), 1);
    } else if (this.nowMs - this.touchPressedAt < MIN_PRESS_MS) {
      this.pendingRelease = { x, y, at: this.touchPressedAt + MIN_PRESS_MS };
    } else {
      this.display._gm_touch(Math.round(x), Math.round(y), 0);
    }
  }

  /** Advances the whole system by `ms` milliseconds of virtual time. */
  run(ms: number): void {
    const end = this.nowMs + ms;
    while (this.nowMs < end) this.tick();
  }

  private tick(): void {
    const t = this.nowMs;
    if (this.pendingRelease && t >= this.pendingRelease.at) {
      this.display._gm_touch(Math.round(this.pendingRelease.x), Math.round(this.pendingRelease.y), 0);
      this.pendingRelease = null;
    }
    this.controller._gm_advance(t * 1000);
    this.display._gm_advance(t * 1000);
    if (t >= this.nextZeroCrossMs) {
      this.controller._gm_interrupt(PIN.PUMP_SENSE);
      this.machine.onZeroCross(this.pin('controller', PIN.PUMP));
      this.nextZeroCrossMs += this.machine.zeroCrossIntervalMs();
    }
    this.machine.step(0.001, { heater: this.pin('controller', PIN.HEATER), pump: this.pin('controller', PIN.PUMP), valve: this.pin('controller', PIN.VALVE) }, t);
    this.acc.pump += this.machine.qPump;
    this.acc.cup += this.machine.qCup;
    this.acc.n++;
    this.link.step(t);
    for (const grams of this.scale.step(t, this.machine.cupMl)) this.display._gm_scale_measurement(grams);
    this.nowMs = t + 1;
    if (this.nowMs >= this.nextSampleMs) {
      this.nextSampleMs = this.nowMs + this.sampleIntervalMs;
      this.record();
    }
  }

  private record(): void {
    const c = this.controllerInspector.read();
    const d = this.displayInspector.read();
    const m = this.machine;
    const n = Math.max(1, this.acc.n);
    // The firmware zeroes its water-pumped counter on every tare; follow it so both read from the same start.
    if (c.pumpPumpedWater < this.lastModelPumped - 0.5) this.pumpedAtTare = m.pumpedMl;
    this.lastModelPumped = c.pumpPumpedWater;
    const sample: Sample = {
      t: this.nowMs / 1000,
      pressure: m.pressure,
      sensorPressure: c.sensorPressure,
      targetPressure: d.targetPressure,
      pumpFlow: this.acc.pump / n,
      pumpFlowModel: d.pumpFlow,
      targetFlow: d.targetFlow,
      cupFlow: this.acc.cup / n,
      puckFlowModel: d.puckFlow,
      cupMl: m.cupMl,
      scale: this.scale.lastReading,
      coffeeVolumeModel: c.pcCoffeeOutput,
      pumpedPhysical: m.pumpedMl - this.pumpedAtTare,
      pumpedModel: c.pumpPumpedWater,
      waterC: m.waterC,
      thermocoupleC: m.thermocoupleC,
      brewWaterC: m.brewWaterC,
      groupC: m.groupC,
      targetC: d.targetTemp,
      heaterDuty: c.heaterOutput / 10,
      pumpPower: c.pumpPower,
      puckResistance: m.params.basket === 'puck' ? m.puck.resistance() : NaN,
      puckResistanceModel: c.pcPuckResistance,
      phaseIndex: d.brewPhaseIndex,
    };
    this.acc = { pump: 0, cup: 0, n: 0 };
    this.samples.push(sample);
    if (this.samples.length > 20000) this.samples.splice(0, this.samples.length - 20000);
    this.trackShot(sample, d.processActive === 1 && d.processType === 1);
  }

  private trackShot(sample: Sample, brewing: boolean): void {
    let shot = this.shots.at(-1);
    if (brewing && (!shot || shot.endS !== null)) {
      shot = { startS: sample.t, endS: null, samples: this.samples.filter(x => x.t >= sample.t - SHOT_LEAD_S) };
      this.shots.push(shot);
      return;
    }
    if (!shot || (shot.endS !== null && sample.t > shot.endS + SHOT_TAIL_S)) return;
    if (!brewing && shot.endS === null) shot.endS = sample.t;
    shot.samples.push(sample);
  }

  displayState(): Record<string, number> {
    return this.displayInspector.read();
  }

  controllerState(): Record<string, number> {
    return this.controllerInspector.read();
  }

  displayPhaseName(): string {
    return this.display.UTF8ToString(this.display._gm_inspect_display_phase());
  }

  displayProfileName(): string {
    return this.display.UTF8ToString(this.display._gm_inspect_display_profile());
  }

  framebuffer(): Uint16Array {
    return new Uint16Array(this.display.HEAPU16.buffer, this.display._gm_display_framebuffer(), 480 * 480);
  }

  frames(): number {
    return this.display._gm_display_frames();
  }
}

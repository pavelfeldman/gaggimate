// Owns the virtual clock and wires the two firmware modules to the machine model, the BLE link
// and the scale. Each 1 ms tick: firmware runs up to t, the mains zero crossing fires the
// controller's PSM interrupt, physics advances one step using the pins the firmware drives, then
// the radio and the scale deliver whatever is due.
import { Random } from '../platform/random.js';
import { Machine } from '../physics/Machine.js';
import { Scale } from '../physics/Scale.js';
import { BleLink } from './BleLink.js';
import { loadModule, deliver, Inspector } from './WasmBoard.js';
import { WebServerBridge } from './WebServerBridge.js';
// GaggiMate Pro Rev 1.1 pins (lib/GaggiMateController/src/ControllerConfig.h)
export const PIN = { HEATER: 14, PUMP: 9, PUMP_SENSE: 21, VALVE: 10, ALT: 47, BREW_BTN: 38, STEAM_BTN: 48, DETECT: 11 };
const BOARD_DETECT_MV = 450; // autodetect value 4 -> Pro Rev 1.1
const LOG_LIMIT = 600;
const SHOT_LEAD_S = 3; // samples kept before the shot starts
const SHOT_TAIL_S = 8; // and after it ends, for the drip-out
export class Simulation {
    options;
    random;
    machine;
    scale;
    link;
    /** HTTP and WebSocket to the display's web server (what the web UI talks to). */
    web = new WebServerBridge(() => this.display);
    controller;
    display;
    controllerInspector;
    displayInspector;
    nowMs = 0;
    brewSwitch = false;
    steamSwitch = false;
    logs = { controller: [], display: [] };
    samples = [];
    shots = [];
    sampleIntervalMs;
    onLog = null;
    pins = { controller: new Map(), display: new Map() };
    nextZeroCrossMs = 0;
    nextSampleMs = 0;
    acc = { pump: 0, cup: 0, n: 0 };
    pumpedAtTare = 0;
    lastModelPumped = 0;
    touchPressedAt = 0;
    pendingRelease = null;
    constructor(options = {}) {
        this.options = options;
        this.random = new Random(options.seed ?? 1);
        this.machine = new Machine(options.machine, (options.seed ?? 1) + 1);
        this.scale = new Scale(new Random((options.seed ?? 1) + 2), options.scale);
        this.link = new BleLink(new Random((options.seed ?? 1) + 3), options.link);
        this.sampleIntervalMs = options.sampleIntervalMs ?? 100;
    }
    async start() {
        this.controller = await loadModule('controller', this.host('controller'));
        this.display = await loadModule('display', this.host('display'));
        this.link.attach('controller', { receive: b => deliver(this.controller, b), setState: s => this.controller._gm_link_state(s) });
        this.link.attach('display', { receive: b => deliver(this.display, b), setState: s => this.display._gm_link_state(s) });
        // A fresh flash: the filesystem image carries the seed profiles (data/p).
        const profiles = this.options.seedProfiles ?? {};
        if (Object.keys(profiles).length) {
            this.display.FS.mkdirTree('/sim_data/littlefs/p');
            for (const [name, json] of Object.entries(profiles))
                this.display.FS.writeFile(`/sim_data/littlefs/p/${name}`, json);
        }
        this.display._gm_display_prepare();
        this.controllerInspector = new Inspector(this.controller, m => m._gm_inspect_controller_names(), m => m._gm_inspect_controller());
        this.displayInspector = new Inspector(this.display, m => m._gm_inspect_display_names(), m => m._gm_inspect_display());
        this.controller._gm_boot();
        this.display._gm_boot();
    }
    host(side) {
        const pins = this.pins[side];
        return {
            pinMode: () => { },
            digitalWrite: (pin, value) => void pins.set(pin, value),
            digitalRead: pin => this.readPin(side, pin),
            analogReadMilliVolts: pin => (side === 'controller' && pin === PIN.DETECT ? BOARD_DETECT_MV : 0),
            adcVolts: channel => (side === 'controller' && channel === 0 ? this.machine.pressureSensorVolts() : 0),
            thermocoupleC: () => this.machine.thermocouple(),
            random: () => Math.floor(this.random.next() * 2 ** 32),
            linkSend: bytes => this.link.send(side, bytes),
            linkRequest: request => this.link.request(side, request, this.nowMs),
            linkLowLatency: active => void (this.link.lowLatency = active),
            webSend: (conn, bytes) => this.web.received(conn, bytes),
            webClose: conn => this.web.closed(conn),
            event: name => {
                if (name === 'scale:tare')
                    this.scale.requestTare(this.nowMs);
            },
            log: (level, text) => this.pushLog(side, level, text),
        };
    }
    readPin(side, pin) {
        if (side === 'controller') {
            if (pin === PIN.BREW_BTN)
                return this.brewSwitch ? 0 : 1; // switches pull to ground
            if (pin === PIN.STEAM_BTN)
                return this.steamSwitch ? 0 : 1;
        }
        return 1; // inputs idle high (pull-ups, absent HX711)
    }
    pushLog(side, level, text) {
        const line = { tMs: this.nowMs, level, text };
        const list = this.logs[side];
        list.push(line);
        if (list.length > LOG_LIMIT)
            list.shift();
        this.onLog?.(side, line);
    }
    pin(side, pin) {
        return (this.pins[side].get(pin) ?? 0) !== 0;
    }
    // LVGL samples the pointer every UI loop (25 ms); a press shorter than a couple of samples is
    // invisible to it, so releases are held back until the press lasted MIN_PRESS_MS of virtual time.
    touch(x, y, pressed) {
        const MIN_PRESS_MS = 60;
        if (pressed) {
            this.touchPressedAt = this.nowMs;
            this.pendingRelease = null;
            this.display._gm_touch(Math.round(x), Math.round(y), 1);
        }
        else if (this.nowMs - this.touchPressedAt < MIN_PRESS_MS) {
            this.pendingRelease = { x, y, at: this.touchPressedAt + MIN_PRESS_MS };
        }
        else {
            this.display._gm_touch(Math.round(x), Math.round(y), 0);
        }
    }
    /** Advances the whole system by `ms` milliseconds of virtual time. */
    run(ms) {
        const end = this.nowMs + ms;
        while (this.nowMs < end)
            this.tick();
    }
    tick() {
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
        for (const grams of this.scale.step(t, this.machine.cupMl))
            this.display._gm_scale_measurement(grams);
        this.nowMs = t + 1;
        if (this.nowMs >= this.nextSampleMs) {
            this.nextSampleMs = this.nowMs + this.sampleIntervalMs;
            this.record();
        }
    }
    record() {
        const c = this.controllerInspector.read();
        const d = this.displayInspector.read();
        const m = this.machine;
        const n = Math.max(1, this.acc.n);
        // The firmware zeroes its water-pumped counter on every tare; follow it so both read from the same start.
        if (c.pumpPumpedWater < this.lastModelPumped - 0.5)
            this.pumpedAtTare = m.pumpedMl;
        this.lastModelPumped = c.pumpPumpedWater;
        const sample = {
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
        if (this.samples.length > 20000)
            this.samples.splice(0, this.samples.length - 20000);
        this.trackShot(sample, d.processActive === 1 && d.processType === 1);
    }
    trackShot(sample, brewing) {
        let shot = this.shots.at(-1);
        if (brewing && (!shot || shot.endS !== null)) {
            shot = { startS: sample.t, endS: null, samples: this.samples.filter(x => x.t >= sample.t - SHOT_LEAD_S) };
            this.shots.push(shot);
            return;
        }
        if (!shot || (shot.endS !== null && sample.t > shot.endS + SHOT_TAIL_S))
            return;
        if (!brewing && shot.endS === null)
            shot.endS = sample.t;
        shot.samples.push(sample);
    }
    displayState() {
        return this.displayInspector.read();
    }
    controllerState() {
        return this.controllerInspector.read();
    }
    displayPhaseName() {
        return this.display.UTF8ToString(this.display._gm_inspect_display_phase());
    }
    displayProfileName() {
        return this.display.UTF8ToString(this.display._gm_inspect_display_profile());
    }
    framebuffer() {
        return new Uint16Array(this.display.HEAPU16.buffer, this.display._gm_display_framebuffer(), 480 * 480);
    }
    frames() {
        return this.display._gm_display_frames();
    }
}
//# sourceMappingURL=Simulation.js.map
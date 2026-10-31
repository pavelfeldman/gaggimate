// Left panel: a conceptual cut-away of the machine, redrawn from the physics state each frame.
import { PIN } from '../host/Simulation.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, String(v));
    parent?.appendChild(node);
    return node;
}
// Blue (cold) -> amber -> red (hot) for 20..150 °C.
function tempColor(t) {
    const x = Math.max(0, Math.min(1, (t - 20) / 110));
    const hue = 215 - 215 * x;
    return `hsl(${hue}, 70%, ${52 - 8 * x}%)`;
}
export class MachineView {
    svg;
    refs = {};
    texts = {};
    constructor(container) {
        const svg = (this.svg = el('svg', { viewBox: '0 0 420 650', role: 'img', 'aria-label': 'Espresso machine schematic' }));
        container.appendChild(svg);
        const style = el('style', {}, svg);
        style.textContent = `
      .pipe { fill: none; stroke: var(--line); stroke-width: 6; stroke-linecap: round; }
      .flow { fill: none; stroke: var(--water); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 6 6; }
      .body { fill: var(--panel); stroke: var(--muted); stroke-width: 1.5; }
      .lbl { fill: var(--muted); font: 11px system-ui, sans-serif; }
      .val { fill: var(--ink); font: 600 12px ui-monospace, Menlo, monospace; }
      .big { fill: var(--ink); font: 600 15px ui-monospace, Menlo, monospace; }`;
        // Pipes (drawn first, under the components)
        el('path', { class: 'pipe', d: 'M65 170 V206' }, svg); // tank -> pump
        el('path', { class: 'pipe', d: 'M89 230 H220' }, svg); // pump -> boiler
        el('path', { class: 'pipe', d: 'M150 230 V262' }, svg); // tee -> sensor
        el('path', { class: 'pipe', d: 'M120 230 V200 H118 V110 H110' }, svg); // OPV return to tank
        el('path', { class: 'pipe', d: 'M290 310 V336' }, svg); // boiler -> valve
        el('path', { class: 'pipe', d: 'M290 358 V372' }, svg); // valve -> group
        el('path', { class: 'pipe', d: 'M302 347 H380 V590' }, svg); // valve dump -> drip tray
        el('path', { class: 'pipe', d: 'M360 240 H395 V420' }, svg); // steam wand
        this.refs.flowIn = el('path', { class: 'flow', d: 'M65 170 V206 M89 230 H220' }, svg);
        this.refs.flowOpv = el('path', { class: 'flow', d: 'M120 230 V200 H118 V110 H110' }, svg);
        this.refs.flowGroup = el('path', { class: 'flow', d: 'M290 310 V336 M290 358 V372' }, svg);
        this.refs.flowDump = el('path', { class: 'flow', d: 'M302 347 H380 V590' }, svg);
        this.refs.flowWand = el('path', { class: 'flow', d: 'M360 240 H395 V420' }, svg);
        // Tank
        el('rect', { class: 'body', x: 20, y: 20, width: 90, height: 150, rx: 8 }, svg);
        this.refs.tankWater = el('rect', { x: 22, y: 22, width: 86, height: 146, rx: 6, fill: 'var(--water)', opacity: 0.35 }, svg);
        this.label(65, 14, 'Tank');
        this.texts.tank = this.value(65, 100, '', 'val');
        // Pump
        this.refs.pump = el('circle', { class: 'body', cx: 65, cy: 230, r: 24 }, svg);
        this.label(65, 268, 'Vibratory pump');
        this.texts.pump = this.value(65, 234, '', 'val');
        this.texts.pumpFlow = this.value(65, 282, '', 'lbl');
        // OPV
        el('path', { class: 'body', d: 'M112 196 l8 -8 l8 8 z' }, svg);
        this.label(150, 186, 'OPV');
        this.texts.opv = this.value(150, 200, '', 'lbl');
        // Pressure sensor gauge
        el('circle', { class: 'body', cx: 150, cy: 300, r: 36 }, svg);
        for (let i = 0; i <= 16; i += 2) {
            const a = Math.PI * (0.75 + (1.5 * i) / 16);
            el('line', { x1: 150 + 30 * Math.cos(a), y1: 300 + 30 * Math.sin(a), x2: 150 + 34 * Math.cos(a), y2: 300 + 34 * Math.sin(a), stroke: 'var(--muted)', 'stroke-width': 1.5 }, svg);
        }
        this.refs.needle = el('line', { x1: 150, y1: 300, x2: 150, y2: 272, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
        this.texts.pressure = this.value(150, 326, '', 'val');
        this.label(150, 352, 'Pressure (bar)');
        this.texts.sensor = this.value(150, 366, '', 'lbl');
        // Boiler
        this.refs.boiler = el('rect', { x: 220, y: 200, width: 140, height: 110, rx: 14, stroke: 'var(--muted)', 'stroke-width': 1.5 }, svg);
        this.refs.heater = el('path', { d: 'M232 296 q10 -12 20 0 t20 0 t20 0 t20 0 t20 0 t20 0', fill: 'none', stroke: 'var(--muted)', 'stroke-width': 3 }, svg);
        this.label(290, 194, 'Boiler');
        this.texts.water = this.value(290, 240, '', 'big');
        this.texts.boilerSub = this.value(290, 258, '', 'lbl');
        this.texts.heater = this.value(290, 276, '', 'lbl');
        // 3-way valve
        this.refs.valve = el('rect', { x: 278, y: 336, width: 24, height: 22, rx: 4, class: 'body' }, svg);
        this.texts.valve = this.value(250, 351, '', 'lbl');
        // Group head, headspace, puck
        el('path', { class: 'body', d: 'M236 372 H344 L334 398 H246 Z' }, svg);
        this.label(200, 388, 'Group');
        this.texts.group = this.value(200, 402, '', 'lbl');
        el('rect', { class: 'body', x: 246, y: 398, width: 88, height: 46, rx: 4 }, svg);
        this.refs.headspace = el('rect', { x: 248, y: 400, width: 84, height: 0, fill: 'var(--water)', opacity: 0.45 }, svg);
        this.refs.puck = el('rect', { x: 248, y: 420, width: 84, height: 22, rx: 2, fill: '#a07a52' }, svg);
        el('path', { d: 'M334 420 h50', stroke: 'var(--muted)', 'stroke-width': 7, 'stroke-linecap': 'round' }, svg); // portafilter handle
        this.texts.puck = this.value(290, 460, '', 'lbl');
        this.texts.puckSub = this.value(290, 474, '', 'lbl');
        // Stream, cup, scale
        this.refs.stream = el('line', { x1: 290, y1: 446, x2: 290, y2: 520, stroke: 'var(--coffee)', 'stroke-width': 0, 'stroke-linecap': 'round' }, svg);
        el('path', { class: 'body', d: 'M258 500 H322 L316 570 H264 Z' }, svg);
        this.refs.coffee = el('path', { d: '', fill: 'var(--coffee)', opacity: 0.85 }, svg);
        el('rect', { class: 'body', x: 236, y: 572, width: 108, height: 16, rx: 3 }, svg);
        this.texts.scale = this.value(290, 584, '', 'val');
        this.texts.cup = this.value(200, 540, '', 'lbl');
        this.label(200, 526, 'Cup');
        // Drip tray, wand
        el('rect', { class: 'body', x: 210, y: 592, width: 190, height: 18, rx: 4 }, svg);
        this.refs.drip = el('rect', { x: 212, y: 594, width: 0, height: 14, rx: 3, fill: 'var(--water)', opacity: 0.4 }, svg);
        this.label(305, 626, 'Drip tray');
        this.texts.drip = this.value(305, 640, '', 'lbl');
        this.label(395, 434, 'Wand');
        this.texts.wand = this.value(395, 448, '', 'lbl');
    }
    label(x, y, text) {
        const t = el('text', { x, y, class: 'lbl', 'text-anchor': 'middle' }, this.svg);
        t.textContent = text;
        return t;
    }
    value(x, y, text, cls) {
        const t = el('text', { x, y, class: cls, 'text-anchor': 'middle' }, this.svg);
        t.textContent = text;
        return t;
    }
    update(sim) {
        const m = sim.machine;
        const p = m.params;
        const c = sim.controllerState();
        const set = (k, s) => {
            if (this.texts[k].textContent !== s)
                this.texts[k].textContent = s;
        };
        const flow = (k, q) => {
            const path = this.refs[k];
            path.style.opacity = q > 0.05 ? '1' : '0';
            path.style.strokeDashoffset = String(-((sim.nowMs / 40) * Math.min(1, q / 4)) % 12);
        };
        const level = Math.max(0, Math.min(1, m.tankMl / p.tankCapacityMl));
        this.refs.tankWater.setAttribute('y', String(22 + 146 * (1 - level)));
        this.refs.tankWater.setAttribute('height', String(146 * level));
        set('tank', `${Math.round(m.tankMl)} ml`);
        const stroking = m.qPump > 0.1;
        this.refs.pump.style.fill = stroking ? 'color-mix(in srgb, var(--water) 30%, var(--panel))' : '';
        this.refs.pump.setAttribute('transform', stroking ? `translate(${(sim.nowMs % 20) < 10 ? 0.8 : -0.8} 0)` : '');
        set('pump', `${Math.round(c.pumpPower ?? 0)}%`);
        set('pumpFlow', `${m.qPump.toFixed(1)} ml/s · total ${Math.round(m.pumpedMl)} ml`);
        set('opv', m.qOpv > 0.05 ? `${m.qOpv.toFixed(1)} ml/s back` : `opens ${p.opvBar} bar`);
        flow('flowIn', m.qPump);
        flow('flowOpv', m.qOpv);
        const ang = Math.PI * (0.75 + (1.5 * Math.min(16, m.pressure)) / 16);
        this.refs.needle.setAttribute('x2', String(150 + 28 * Math.cos(ang)));
        this.refs.needle.setAttribute('y2', String(300 + 28 * Math.sin(ang)));
        set('pressure', m.pressure.toFixed(1));
        set('sensor', `firmware reads ${(c.sensorPressure ?? 0).toFixed(1)}`);
        this.refs.boiler.style.fill = tempColor(m.waterC);
        this.refs.heater.setAttribute('stroke', m.heaterOn ? '#ff7a1a' : 'var(--muted)');
        set('water', `${m.waterC.toFixed(1)} °C`);
        set('boilerSub', `thermocouple ${m.thermocoupleC.toFixed(1)} °C`);
        set('heater', `heater ${m.heaterOn ? 'ON' : 'off'} · duty ${((c.heaterOutput ?? 0) / 10).toFixed(0)}%`);
        const valveOpen = sim.pin('controller', PIN.VALVE);
        this.refs.valve.style.fill = valveOpen ? 'var(--good)' : '';
        set('valve', valveOpen ? '3-way open' : '3-way closed');
        flow('flowGroup', m.qGroup);
        flow('flowDump', !valveOpen && m.headspaceMl > 0 ? 3 : 0);
        flow('flowWand', m.qWand);
        set('group', `${m.groupC.toFixed(0)} °C · brew ${m.brewWaterC.toFixed(0)} °C`);
        const head = Math.min(1, m.headspaceMl / p.headspaceMl);
        this.refs.headspace.setAttribute('height', String(20 * head));
        if (p.basket === 'puck') {
            const s = m.puck.saturation();
            const height = Math.max(8, Math.min(22, m.puck.heightMm() * 2.4));
            this.refs.puck.setAttribute('y', String(442 - height));
            this.refs.puck.setAttribute('height', String(height));
            this.refs.puck.setAttribute('fill', `hsl(28, ${45 - 10 * s}%, ${52 - 34 * s}%)`);
            set('puck', `${p.doseG} g · ${p.puckDensity.toFixed(2)} g/ml · ${p.grindUm} µm`);
            set('puckSub', `wet ${Math.round(s * 100)}% · R ${m.puck.resistance().toFixed(2)} · out ${m.puck.outMl.toFixed(1)} ml`);
        }
        else {
            this.refs.puck.setAttribute('height', '0');
            set('puck', p.basket === 'blind' ? 'blind basket' : 'no portafilter');
            set('puckSub', '');
        }
        this.refs.stream.setAttribute('stroke-width', String(Math.min(6, m.qCup * 1.8)));
        const cupLevel = Math.min(1, m.cupMl / 120);
        const y = 570 - 68 * cupLevel;
        const inset = 6 * (1 - cupLevel);
        this.refs.coffee.setAttribute('d', cupLevel > 0 ? `M${258 + 6 * cupLevel + inset} ${y} H${322 - 6 * cupLevel - inset} L316 570 H264 Z` : '');
        set('cup', p.cupPresent ? `${m.cupMl.toFixed(1)} g` : 'no cup');
        set('scale', sim.scale.params.connected ? `${sim.scale.lastReading.toFixed(1)} g` : 'scale off');
        this.refs.drip.setAttribute('width', String(Math.min(186, m.dripTrayMl / 3)));
        set('drip', `${Math.round(m.dripTrayMl)} ml`);
        set('wand', p.wandOpen ? 'open' : 'closed');
    }
}
//# sourceMappingURL=MachineView.js.map
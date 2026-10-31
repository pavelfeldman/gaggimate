// Minimal canvas line charts over the simulation's sample stream.

import type { Sample } from '../host/Simulation.js';

export interface Series {
  key: keyof Sample;
  label: string;
  color: string; // CSS color or var(--token)
  axis?: 'left' | 'right';
  dashed?: boolean;
  scale?: number;
}

export interface ChartSpec {
  title: string;
  series: Series[];
  left: { label: string; min?: number; max?: number };
  right?: { label: string; min?: number; max?: number };
}

function resolveColor(el: Element, color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() || '#888' : color;
}

// Widens [lo, hi] to four round steps (1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10^k) for readable gridlines.
function niceAxis(lo: number, hi: number, fixedLo: boolean): [number, number] {
  for (let raw = (hi - lo) / 4; ; ) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * mag).find(s => s >= raw)!;
    const base = fixedLo ? lo : Math.floor(lo / step) * step;
    if (base + 4 * step >= hi) return [base, base + 4 * step];
    raw = step * 1.01;
  }
}

function labelDigits(span: number): number {
  const step = span / 4;
  return Number.isInteger(step) ? 0 : Number.isInteger(step * 10) ? 1 : 2;
}

export class LineChart {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;

  constructor(private readonly spec: ChartSpec) {
    this.root = document.createElement('div');
    this.root.className = 'chart';
    const title = document.createElement('h2');
    title.textContent = spec.title;
    const legend = document.createElement('div');
    legend.className = 'legend';
    for (const s of spec.series) {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = s.dashed ? '' : s.color;
      swatch.style.color = s.color;
      if (s.dashed) swatch.className = 'dash';
      item.append(swatch, `${s.label}${s.axis === 'right' ? ' (right)' : ''}`);
      legend.append(item);
    }
    this.canvas = document.createElement('canvas');
    this.root.append(title, legend, this.canvas);
  }

  /** Draws samples in [tStart, tEnd] (s); time labels count from `origin`. */
  draw(samples: Sample[], tStart: number, tEnd: number, origin = 0): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const muted = resolveColor(canvas, 'var(--muted)');
    const grid = resolveColor(canvas, 'var(--chart-grid)');
    const pad = { l: 38, r: this.spec.right ? 38 : 10, t: 6, b: 18 };
    const windowS = Math.max(1e-3, tEnd - tStart);
    const visible = samples.filter(s => s.t >= tStart && s.t <= tEnd);

    const range = (axis: 'left' | 'right'): [number, number] => {
      const spec = axis === 'left' ? this.spec.left : this.spec.right!;
      let lo = spec.min ?? Infinity;
      let hi = spec.max ?? -Infinity;
      if (spec.min === undefined || spec.max === undefined) {
        for (const s of this.spec.series.filter(x => (x.axis ?? 'left') === axis)) {
          for (const p of visible) {
            const v = (p[s.key] as number) * (s.scale ?? 1);
            if (!Number.isFinite(v)) continue;
            if (spec.min === undefined) lo = Math.min(lo, v);
            if (spec.max === undefined) hi = Math.max(hi, v);
          }
        }
      }
      if (!Number.isFinite(lo)) lo = 0;
      if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;
      if (spec.max !== undefined && spec.min !== undefined) return [lo, hi];
      return niceAxis(lo, hi + (hi - lo) * 0.02, spec.min !== undefined);
    };
    const ranges = { left: range('left'), right: this.spec.right ? range('right') : ([0, 1] as [number, number]) };
    const x = (t: number) => pad.l + ((t - tStart) / windowS) * (w - pad.l - pad.r);
    const y = (v: number, axis: 'left' | 'right') => {
      const [lo, hi] = ranges[axis];
      return pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    };

    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = pad.t + (i / 4) * (h - pad.t - pad.b);
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
      ctx.fillStyle = muted;
      const [lo, hi] = ranges.left;
      ctx.textAlign = 'right';
      ctx.fillText((hi - ((hi - lo) * i) / 4).toFixed(labelDigits(hi - lo)), pad.l - 4, gy + 3);
      if (this.spec.right) {
        const [rlo, rhi] = ranges.right;
        ctx.textAlign = 'left';
        ctx.fillText((rhi - ((rhi - rlo) * i) / 4).toFixed(labelDigits(rhi - rlo)), w - pad.r + 4, gy + 3);
      }
    }
    ctx.textAlign = 'center';
    const step = [5, 10, 30, 60, 120, 300, 600].find(v => windowS / v <= 8) ?? 1200;
    for (let s = Math.ceil((tStart - origin) / step) * step; s <= tEnd - origin; s += step) ctx.fillText(`${s}s`, x(s + origin), h - 4);

    for (const s of this.spec.series) {
      const axis = s.axis ?? 'left';
      ctx.strokeStyle = resolveColor(canvas, s.color);
      ctx.lineWidth = 1.6;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      let pen = false;
      for (const p of visible) {
        const v = (p[s.key] as number) * (s.scale ?? 1);
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const px = x(p.t);
        const py = y(v, axis);
        if (pen) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

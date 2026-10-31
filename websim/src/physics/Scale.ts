// Simulated BLE scale under the cup: samples the cup at its own rate, quantizes, filters, and
// delivers each reading after a radio latency — the display firmware receives it the same way
// BLEScalePlugin would hand it over.

import { Random } from '../platform/random.js';

export interface ScaleParams {
  connected: boolean;
  rateHz: number;
  latencyMs: number;
  resolutionG: number;
  noiseG: number;
  filter: number; // EMA weight of the newest sample (scale firmware smoothing)
  cupMassG: number; // tared away when the shot starts
}

export const DEFAULT_SCALE: ScaleParams = {
  connected: true,
  rateHz: 10,
  latencyMs: 120,
  resolutionG: 0.1,
  noiseG: 0.03,
  filter: 0.6,
  cupMassG: 0,
};

export class Scale {
  params: ScaleParams;
  private filtered = 0;
  private tareOffset = 0;
  private nextSampleMs = 0;
  private readonly pending: { at: number; grams: number }[] = [];
  private pendingTareAt = -1;
  lastReading = 0;

  constructor(
    private readonly random: Random,
    params: Partial<ScaleParams> = {},
  ) {
    this.params = { ...DEFAULT_SCALE, ...params };
  }

  // The display asked for a tare; the scale applies it when the command arrives.
  requestTare(nowMs: number): void {
    this.pendingTareAt = nowMs + this.params.latencyMs;
  }

  // Advances to nowMs; returns readings whose delivery time has come.
  step(nowMs: number, cupMl: number): number[] {
    const mass = cupMl + this.params.cupMassG;
    if (this.pendingTareAt >= 0 && nowMs >= this.pendingTareAt) {
      this.tareOffset = mass;
      this.filtered = 0;
      this.pendingTareAt = -1;
    }
    if (this.params.connected && nowMs >= this.nextSampleMs) {
      this.nextSampleMs = nowMs + 1000 / this.params.rateHz;
      const raw = mass - this.tareOffset + this.random.gaussian() * this.params.noiseG;
      this.filtered = this.params.filter * raw + (1 - this.params.filter) * this.filtered;
      const reading = Math.round(this.filtered / this.params.resolutionG) * this.params.resolutionG;
      this.pending.push({ at: nowMs + this.params.latencyMs, grams: reading });
    }
    const due: number[] = [];
    while (this.pending.length && this.pending[0].at <= nowMs) {
      const r = this.pending.shift()!;
      this.lastReading = r.grams;
      if (this.params.connected) due.push(r.grams);
    }
    return due;
  }
}

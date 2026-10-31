// Seeded PRNG so every noise source is reproducible: the same seed and inputs replay the same shot.

export class Random {
  private state = 1;
  private spare: number | null = null;

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    this.state = seed >>> 0 || 1;
    this.spare = null;
  }

  /** Uniform in [0, 1) (mulberry32). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal (Box–Muller). */
  gaussian(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

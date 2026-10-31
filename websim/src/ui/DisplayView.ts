// Top-right panel: blits the display firmware's RGB565 framebuffer into a canvas and turns pointer
// input into LVGL touches.

import type { Simulation } from '../host/Simulation.js';

export class DisplayView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private lastFrame = -1;
  pressed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: () => Simulation | null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(480, 480);
    const toPanel = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 480, ((e.clientY - r.top) / r.height) * 480];
    };
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.pressed = true;
      this.sim()?.touch(...toPanel(e), true);
    });
    canvas.addEventListener('pointermove', e => {
      if (this.pressed) this.sim()?.touch(...toPanel(e), true);
    });
    const release = (e: PointerEvent) => {
      if (!this.pressed) return;
      this.pressed = false;
      this.sim()?.touch(...toPanel(e), false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  reset(): void {
    this.lastFrame = -1;
  }

  draw(): void {
    const sim = this.sim();
    if (!sim) return;
    const frame = sim.frames();
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    const fb = sim.framebuffer();
    const px = this.image.data;
    for (let i = 0, j = 0; i < fb.length; i++, j += 4) {
      const v = fb[i];
      px[j] = ((v >> 11) & 31) * 8.226;
      px[j + 1] = ((v >> 5) & 63) * 4.048;
      px[j + 2] = (v & 31) * 8.226;
      px[j + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    const brightness = sim.display._gm_display_brightness();
    this.canvas.style.filter = `brightness(${0.35 + 0.65 * Math.min(1, brightness / 16)})`;
  }
}

// One ESP32 board: an Emscripten module built from the real firmware (wasm/CMakeLists.txt) plus
// the host side of its HAL. The module's gm_hal.js imports call into `GmHost`.

export interface GmHost {
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, value: number): void;
  digitalRead(pin: number): number;
  analogReadMilliVolts(pin: number): number;
  adcVolts(channel: number): number;
  thermocoupleC(): number;
  random(): number;
  linkSend(bytes: Uint8Array): void;
  linkRequest(request: number): void;
  linkLowLatency(active: boolean): void;
  webSend(conn: number, bytes: Uint8Array): void;
  webClose(conn: number): void;
  event(name: string, value: number): void;
  log(level: string, line: string): void;
}

interface EmscriptenFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: string): void;
}

/** Exports shared by both firmware modules (see COMMON_EXPORTS). */
export interface GmModule {
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPF64: Float64Array;
  FS: EmscriptenFS;
  UTF8ToString(ptr: number): string;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _gm_boot(): void;
  _gm_advance(targetUs: number): void;
  _gm_time_us(): number;
  _gm_interrupt(pin: number): void;
  _gm_link_receive(ptr: number, length: number): void;
  _gm_link_state(state: number): void;
}

export interface ControllerModule extends GmModule {
  _gm_inspect_controller(): number;
  _gm_inspect_controller_names(): number;
}

export interface DisplayModule extends GmModule {
  _gm_display_prepare(): void;
  _gm_display_framebuffer(): number;
  _gm_display_frames(): number;
  _gm_display_brightness(): number;
  _gm_touch(x: number, y: number, pressed: number): void;
  _gm_scale_measurement(grams: number): void;
  _gm_inspect_display(): number;
  _gm_inspect_display_names(): number;
  _gm_inspect_display_phase(): number;
  _gm_inspect_display_profile(): number;
  _gm_web_open(): number;
  _gm_web_write(conn: number, ptr: number, length: number): void;
  _gm_web_end(conn: number): void;
}

type Factory<M> = (moduleArg: { gmHost: GmHost; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<M>;

export async function loadModule<M extends GmModule>(name: 'controller' | 'display', host: GmHost): Promise<M> {
  const url = new URL(`../../wasm/${name}.mjs`, import.meta.url);
  const factory = (await import(url.href)).default as Factory<M>;
  const stray = (s: string) => host.log('I', s);
  return factory({ gmHost: host, print: stray, printErr: stray });
}

export interface LogLine {
  tMs: number;
  level: string;
  text: string;
}

export class Inspector<M extends GmModule> {
  readonly names: string[];
  constructor(
    private readonly module: M,
    namesFn: (m: M) => number,
    private readonly valuesFn: (m: M) => number,
  ) {
    this.names = JSON.parse(module.UTF8ToString(namesFn(module))).filter((n: string) => n !== '_');
  }

  read(): Record<string, number> {
    const ptr = this.valuesFn(this.module);
    const values = new Float64Array(this.module.HEAPF64.buffer, ptr, this.names.length);
    const out: Record<string, number> = {};
    this.names.forEach((n, i) => (out[n] = values[i]));
    return out;
  }
}

/** Copies a datagram into the module's heap and hands it to its transport (which frees it). */
export function deliver(module: GmModule, bytes: Uint8Array): void {
  const ptr = module._malloc(bytes.length);
  module.HEAPU8.set(bytes, ptr);
  module._gm_link_receive(ptr, bytes.length);
}

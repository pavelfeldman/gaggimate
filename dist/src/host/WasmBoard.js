// One ESP32 board: an Emscripten module built from the real firmware (wasm/CMakeLists.txt) plus
// the host side of its HAL. The module's gm_hal.js imports call into `GmHost`.
export async function loadModule(name, host) {
    const url = new URL(`../../wasm/${name}.mjs`, import.meta.url);
    const factory = (await import(url.href)).default;
    const stray = (s) => host.log('I', s);
    return factory({ gmHost: host, print: stray, printErr: stray });
}
export class Inspector {
    module;
    valuesFn;
    names;
    constructor(module, namesFn, valuesFn) {
        this.module = module;
        this.valuesFn = valuesFn;
        this.names = JSON.parse(module.UTF8ToString(namesFn(module))).filter((n) => n !== '_');
    }
    read() {
        const ptr = this.valuesFn(this.module);
        const values = new Float64Array(this.module.HEAPF64.buffer, ptr, this.names.length);
        const out = {};
        this.names.forEach((n, i) => (out[n] = values[i]));
        return out;
    }
}
/** Copies a datagram into the module's heap and hands it to its transport (which frees it). */
export function deliver(module, bytes) {
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    module._gm_link_receive(ptr, bytes.length);
}
//# sourceMappingURL=WasmBoard.js.map
# GaggiMate Web Simulator — Migration (WASM)

Goal: a browser app that runs the **actual GaggiMate firmware** for both ESP32 boards, compiled
from the C++ in this repo to WebAssembly, against a physical model of a Gaggia Classic (Pro)
with a GaggiMate Pro board. The firmware is not re-implemented; only the hardware underneath it
is simulated. This started as the plan and now records what was built; see `README.md` to run it.

| Panel        | Content                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| Left         | Conceptual machine: tank, pump, OPV, pressure sensor, boiler + heater, 3-way valve, group, headspace, puck, cup + scale, drip tray. Physical brew/steam switches, steam knob, puck controls. |
| Top right    | The real LVGL display UI (`DefaultUI` + EEZ screens), rendered by the display firmware into a 480×480 canvas. Mouse = touch. |
| Bottom right | Live internal parameters (controller PID terms, pressure-controller state, BLE link, physics) and charts. |

## 1. Principles

1. **Run the firmware, don't port it.** Every file under `src/` and `lib/` that runs on the boards
   is compiled unmodified, except for the small, guarded touch points listed in §5.
2. **Only hardware is replaced.** GPIO, ADC, SPI thermocouple, mains zero-cross, NVS/flash and
   BLE are provided by a platform layer whose bottom edge calls into the TypeScript physics model.
3. **Same timing.** FreeRTOS tasks keep their real bodies (infinite loops with `vTaskDelay`,
   `xTaskDelayUntil`, `ulTaskNotifyTake`, blocking `delay()`), scheduled cooperatively on a
   virtual clock. Periods, ISR cadence and ordering match the device; wall-clock speed is
   independent (pause, 1×–10×, max = 200×).
4. **Deterministic.** One seeded PRNG in the host drives all noise; a shot replays identically for
   the same seed and inputs. Tests run headless in Node against the same `.wasm` files.
5. **Typed host.** Everything that isn't firmware (physics, link model, UI) is TypeScript
   (`strict`), compiled with the pinned `typescript` dev dependency. No bundler, no runtime deps.

## 2. Architecture

```
            ┌──────────────── browser / node ─────────────────┐
            │  host (TS): virtual clock · physics · BLE link  │
            │      ▲ HAL imports            ▲ HAL imports     │
            │      │ exports                │ exports         │
            │ ┌────┴─────────────┐   ┌──────┴──────────────┐  │
            │ │ controller.wasm  │   │ display.wasm        │  │
            │ │ src/controller   │   │ src/display (+LVGL) │  │
            │ │ GaggiMateCtrl,   │   │ Controller, DefaultUI│ │
            │ │ NayrodPID, PSM,  │   │ processes, profiles │  │
            │ │ NanoPbComm server│   │ NanoPbComm client   │  │
            │ └──────────────────┘   └─────────────────────┘  │
            └──────────────────────────────────────────────────┘
```

* **Two modules, not one.** Each firmware has its own `setup()`/`loop()` and a global named
  `controller`, so they are built as separate Emscripten modules (`-sMODULARIZE -sEXPORT_ES6`),
  each with its own heap, clock offset and HAL.
* **Clock.** The host owns time. Each 1 ms tick: `controller._gm_advance(t)` and
  `display._gm_advance(t)` run every task, timer and ISR due by `t` in time order; then the mains
  zero crossing raises the controller's PSM interrupt (pin 21) when due; then physics steps 1 ms on
  the pins the firmware drives (heater 14, pump 9, valve 10); then the link and the scale deliver
  whatever is due. `millis()`/`micros()`/`esp_timer_get_time()` read the module's virtual time.
* **Link.** The real `Endpoint` (framing, coalescing queue, ACK/retransmit, dedup) runs in both
  modules. Only the transport is new: `WasmLinkTransport` hands each encoded nanopb datagram to the
  host (`gm_hal_link_send`), which models BLE connection events and delivers it to the peer module
  (`gm_link_receive`). Advertising, scanning and connection state are host-driven too.
* **Web UI.** The display's `WebUIPlugin` and `WebSocketHandler` run on the desktop simulator's
  `ESPAsyncWebServer` (`sim/web`), listening on in-memory connections instead of a socket
  (`display/WebTransport.cpp`). `src/host/WebServerBridge.ts` writes raw HTTP/1.1 and WebSocket
  bytes into them (`gm_web_open/write/end`) and parses the replies (`gm_hal_web_send/close`); the
  server serves them from the loop task between `loop()` iterations, as `sim/main.cpp` pumps its
  sockets. The web UI itself (`web/`, built into `dist/webui` by `scripts/build-webui.mjs`) runs in
  its own tab: `src/webui/bridge.ts`, inlined ahead of the app, sends its `fetch('/api/…')` calls
  and `/ws` socket over a `BroadcastChannel` to the simulator tab (`src/ui/WebUiHost.ts`), and
  `webui/router.ts` keeps preact-iso's routes in the URL fragment so a static host can serve it
  from a subdirectory.

## 3. Build

`wasm/build.sh` (finds emsdk at `$EMSDK` or `~/emsdk`, tested with Emscripten 6.0.13; needs python3 with
`protobuf` + `grpcio-tools` for nanopb's generator) fetches nothing: third-party sources must sit in `wasm/third_party/`
(git-ignored) at the versions `platformio.ini` pins — LVGL 8.4.0, ArduinoJson 7.4.2, nanopb 0.4.9,
gaggimate/PSM.Library. It generates `gaggimate.pb.{c,h}` from `lib/NanoPbComm/proto` with
`--error-on-unmatched`, `version.h` and the empty web UI manifest stub, configures `wasm/CMakeLists.txt` with
`emcmake`, builds, and writes `dist/wasm/seed-profiles.json` from `data/p/`.

| Target | Sources | Notable flags |
| --- | --- | --- |
| `controller` | `lib/GaggiMateController`, `lib/NayrodPID`, `lib/overrides`, `lib/NanoPbComm/src/{Endpoint,GaggiMateServer}.cpp`, PSM, nanopb, `wasm/platform`, `wasm/controller_inspect.cpp`, then `src/controller/main.cpp` **last** | `-DGAGGIMATE_WASM` |
| `display` | `src/display/**` minus `drivers/`, `webassets/` and device-only plugins (MQTT, HomeKit, mDNS, watchdogs, BLEScale, Improv), the real `src/display/main.cpp` (last), `lib/NanoPbComm/src/{Endpoint,GaggiMateClient}.cpp`, `sim/platform` + `sim/web` shims, LVGL, `wasm/platform`, `wasm/display` | `-DGAGGIMATE_WASM -DGAGGIMATE_SIM` |

Both: `-O2 -fno-rtti`, `-sASYNCIFY` (128 KiB Asyncify stack, 1 MiB C stack), `-sMODULARIZE
-sEXPORT_ES6`, `ENVIRONMENT=web,node`, `--js-library wasm/platform/gm_hal.js`. Outputs:
`dist/wasm/{controller,display}.{mjs,wasm}`. `npm run build` = `wasm/build.sh` + `tsc`.

## 4. Platform layer (`wasm/platform/`, C++)

`wasm/platform` comes first on the include path and shadows the repo's `sim/platform` headers;
everything it doesn't replace (WString, Print, Stream, FS, Preferences, ArduinoJson glue) is
`sim/platform` as `display-sim` uses it.

| Piece | Replaces | Notes |
| --- | --- | --- |
| `gm_sched.{h,cpp}`, `freertos/{FreeRTOS,task,queue,semphr}.h`, `esp_timer.h` | FreeRTOS, esp_timer | Each task is an Emscripten fiber. `vTaskDelay`, `xTaskDelayUntil` (FreeRTOS's own arithmetic), `ulTaskNotifyTake`, queue/semaphore waits and `delay()` park the fiber until a virtual time or a wake. `gm_advance(t)` runs due timers before tasks on ties, then priority, then FIFO. A bare `yield()`/`delay(0)` costs 10 µs so busy-waits (PSM's `cps()`) make progress; 100 000 events at one timestamp abort as a runaway. Mutexes are cooperative. |
| `Arduino.h`, `arduino_wasm.cpp` | Arduino core | `millis`/`micros`/`delay` on the virtual clock; GPIO and `analogReadMilliVolts` call the host; `attachInterrupt` handlers run when the host calls `gm_interrupt(pin)`. `Serial` buffers lines and hands them to the host. |
| `esp_log.h` | ESP-IDF logging | `ESP_LOGE/W/I` format `[ms][L][tag] …` and go to the host's log; D/V compile out (as `CORE_DEBUG_LEVEL=3`). |
| `ADS1X15.h` | ADS1115 driver | `requestADC(ch)` latches the host's channel voltage; `isReady()` after the conversion time; counts at gain 0. |
| `MAX31855.h` | thermocouple driver | Host temperature quantized to 0.25 °C; NaN reads as open circuit. |
| `Wire.h`, `SoftWire.h`, `SPI.h`, `ExtensionIOXL9555.hpp` | buses, IO expander | Empty bus: every probe NACKs, so the LED/ToF accessory, gear-pump add-on, hardware scale and IO expander report absent and the firmware's fallbacks run. |
| `WasmBleTransport.{h,cpp}` | `ble/BleClientTransport`, `ble/BleServerTransport` | `BleServerTransport::init` advertises; `BleClientTransport::connectToServer` blocks (up to 5 s) for the host's connection event; `setLowLatency` switches the host's connection interval. Same method surface the facades call. |
| `gm_hal.{h,js}` | — | The import table: pins, ADC, thermocouple, random, link send/request/low-latency, events, logs; forwards to `Module.gmHost`. |
| `arduino_main.cpp` | Arduino's `app_main` | `gm_boot()` creates `loopTask`: `setup()`, then `loop()` forever, each followed by the board's `gm_after_loop()` (the display pumps its web server there). |
| `controller_inspect.cpp`, `display/display_wasm.cpp` | — | Read-only getters for the Internals panel (PID terms, pressure controller, process state). `display_wasm.cpp` also takes scale readings and touches. |
| `display/SdlDriver.{h,cpp}` | `sim/driver/SdlDriver` | Same class name; LVGL flushes into a 480×480 RGB565 framebuffer the host blits to a canvas; touches come from the host. |
| `display/WebTransport.cpp` | the TCP stack under `sim/web/ESPAsyncWebServer` | In-memory connections the host opens and writes to; the server's replies go out through `gm_hal_web_send`/`gm_hal_web_close`. |

## 5. Firmware touch points

The only changes to `src/` and `lib/`; `display-sim` and the PlatformIO builds are unaffected.

1. `lib/NanoPbComm/src/GaggiMateClient.h`, `GaggiMateServer.h`: under `#ifdef GAGGIMATE_WASM`
   include `<WasmBleTransport.h>` instead of `"ble/Ble{Client,Server}Transport.h"` — a quoted
   relative include can't be shadowed through include paths.
2. `[[noreturn]]` moved onto the first declaration of the task functions in
   `lib/GaggiMateController/src/peripherals/{ADSAdc,HardwareScale,Max31855Thermocouple,NtcThermistor}.h`.
   Clang requires it there; GCC accepted it on the definition only. No behaviour change.

Build-level choices, not source edits:

* **`-fno-rtti`**, as the ESP32 toolchain builds: some base classes leave virtuals undefined and
  only link without typeinfo.
* **`main.cpp` linked last.** ESP-IDF runs global constructors in reverse link order; wasm-ld runs
  them forward. Linking `main.cpp` last keeps the device's order, so the board configs exist before
  `controller` is constructed (otherwise board autodetect matches nothing).
* **Logs bypass stdio.** musl's `__stdio_write` can spin on a zero-length `writev` when the first
  stdout write happens inside a fiber and the JS side doesn't write synchronously. `Serial` and
  `ESP_LOGx` go straight to the host instead.
* **`sim/web/ESPAsyncWebServer` has a transport seam** (`AsyncWebTransport`,
  `gm_web_set_transport`): BSD sockets by default for `display-sim`, in-memory connections here.
* **`socket()` fails with `ENETDOWN`** in the display module. Nothing calls it once the in-memory
  transport is installed; defining it keeps Emscripten's socket emulation, which needs Node's `ws`
  package, out of the build.
* **Wi-Fi credentials are seeded** before boot (`gm_display_prepare`), as `sim/main.cpp` does, so
  the display starts in station mode, not the captive portal.

## 6. Simulated stand-ins (deviations)

| Area | Device | Simulator | Why acceptable |
| --- | --- | --- | --- |
| Concurrency | dual-core preemptive FreeRTOS | single-threaded cooperative fibers | Same periods and ordering; cross-core races can't be reproduced. |
| BLE radio | NimBLE GATT | `WasmLinkTransport` + host link model: 600 ms scan, 400 ms connect, connection events every 10 ms while low latency is on and 40 ms otherwise, optional loss, forced drop | Everything above `Transport` is the real stack. |
| BLE scale | `BLEScalePlugin` + vendor drivers (device-only) | Host scale (10 Hz, 0.1 g, 120 ms latency, noise) calls `Controller::onVolumetricMeasurement(g, BLUETOOTH)`; tares on `controller:brew:prestart` and `controller:grind:start`, like the plugin | Vendor BLE code sits outside the control loop. |
| Network | Wi-Fi, web server, MQTT, HomeKit, mDNS, OTA | Web server on in-memory connections from the web UI tab (Web UI button); the rest compiled out or inert | The web UI and its API are the real ones; nothing else on the network takes part in machine control. |
| Panel | LilyGo / Waveshare / AMOLED drivers | framebuffer `SdlDriver` → canvas | Same LVGL UI, different flush target. |
| Logs | UART | Serial/ESP_LOG lines in the Serial logs tab | Same text, different sink. |

## 7. Physics model (`src/physics/`, TypeScript)

Most parameters are sliders in the UI; defaults approximate a Gaggia Classic Pro.

* **Mains.** 50 Hz (or 60 Hz): the host raises the zero-cross ISR at twice mains frequency, which
  feeds the real PSM library; its SSR pin gates the pump.
* **Vibratory pump.** A half-sine stroke on each conducting positive half-cycle, sized so the
  cycle mean follows a linear pump curve (10.2 ml/s at 1 bar, 5.5 ml/s at 9 bar, the firmware's
  default calibration). "Pump vs model" makes the real pump differ from the firmware's model.
* **Hydraulic node.** Pump outlet, boiler and lines as one node with air-cushion compliance
  `C(P) = C0 + Vair/(P+1)²`; outflows through the OPV (back to the tank), the group (3-way valve
  energized) and the steam wand. De-energizing the valve vents the group to the drip tray and seals
  the boiler, so the node holds its pressure after a shot until the wand opens. The sensor sits on
  this node; an optional check-valve offset adds to it while the pump strokes.
* **Headspace and puck.** Water fills the headspace first (little back pressure), then wets the
  puck, which absorbs ~1.1 ml/g before dripping. Flow `Q = Pⁿ / R · μ(T)` ratio; `R` from
  Kozeny–Carman on porosity (puck density vs. coffee solids), grind size and bed height, swelling as
  it saturates, erosion `R / (1 + e · V_out/dose)` so flow rises over the shot, and optional random
  channeling. Drip decays after the valve closes.
* **Thermal.** Boiler metal (1370 W element on the heater pin), boiler water (100 ml, 100 W/K to the
  metal), group (12 W/K to the boiler), ambient losses; water leaving through the group or the wand
  is replaced by tank water. Water at the puck mixes boiler water with the group temperature. The
  thermocouple sits on the metal with a 2 s lag. Above 100 °C the sealed boiler holds at least its
  saturation pressure. With these values, puck water starts near 91 °C and falls about 6 °C over a
  30 s shot; these are estimates, not measured against a Scace.
* **Sensors.** Pressure transducer 0.5–4.5 V over 16 bar into the ADS1115 with noise; MAX31855 at
  0.25 °C; BLE scale as above.

## 8. Verification

`npm test` (`test/sim.test.mjs`, headless Node, the same `.wasm` the browser loads):

1. Both modules boot; the controller autodetects Pro Rev 1.1; the display reaches *Ready* and
   connects over the link.
2. Default profile: heats to 93 °C (±1.5), a full-power shot peaks between 9 bar and the OPV, the
   firmware's filtered pressure tracks the physical one, and the volumetric target stops the shot
   at 36 g with the scale ending within 35–39.5 g.
3. Puck density: 0.9 g/ml pulls at least 1.3× slower than 0.7 g/ml (about 41 s vs 12 s).
4. Erosion: puck resistance falls and cup flow rises during the shot.
5. Web server: `GET /api/settings` answers JSON from the display, and a `/ws` session gets
   `evt:status` pushes and answers `req:profiles:list`.

`node scripts/shot.mjs` prints a whole shot as a table (env `DENSITY`, `EROSION`, `HEAT_S`,
`LOGS`) — about 190 s simulated in under a second. In the browser: wake by tapping the screen,
start a shot from the play button or the brew switch, and the charts follow the last shot.

Known gap the simulator makes visible: at full pump power the OPV returns most of the pump's flow
to the tank, but the firmware's pump model doesn't know about the OPV, so its "water pumped" and
virtual-scale estimates run well ahead of what reaches the cup.

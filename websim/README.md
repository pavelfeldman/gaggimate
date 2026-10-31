# GaggiMate Web Simulator

The real GaggiMate firmware for both boards, compiled to WebAssembly, running against a simulated
Gaggia Classic Pro in the browser. The display's LVGL UI, the controller's PID, pressure controller,
PSM pump control and the nanopb link are the C++ in this repo; only the hardware under them is
simulated (TypeScript). See [MIGRATION.md](MIGRATION.md) for how it's put together.

- **Left:** the machine: tank, pump, OPV, pressure sensor, boiler and heater, 3-way valve, group,
  headspace, puck, cup on a scale, drip tray. Below it are the switches and the puck and machine
  sliders.
- **Top right:** the display firmware's own screen. Click to touch.
- **Bottom right:** live values, then tabs for charts (the last shot, or a rolling window), the
  firmware's internals (PID terms, pressure controller, process state) and both boards' serial logs.
- **Web UI** (header button): the GaggiMate web UI from `web/`, in its own tab, talking to the
  simulated display's real web server and WebSocket API.

## Setup

Emscripten (tested with 6.0.13) in `~/emsdk` or at `$EMSDK`, Node 22+, and python3 with
`protobuf` and `grpcio-tools` for nanopb's generator. The third-party sources go in
`wasm/third_party/` (git-ignored), at the versions the firmware builds pin:

```bash
git clone --depth 1 -b v8.4.0 https://github.com/lvgl/lvgl.git wasm/third_party/lvgl
```

```bash
git clone --depth 1 -b v7.4.2 https://github.com/bblanchon/ArduinoJson.git wasm/third_party/ArduinoJson
```

```bash
git clone --depth 1 -b nanopb-0.4.9 https://github.com/nanopb/nanopb.git wasm/third_party/nanopb
```

```bash
git clone --depth 1 https://github.com/gaggimate/PSM.Library.git wasm/third_party/PSM
```

Then, from `websim/`:

```bash
npm install
```

```bash
npm run build
```

`npm run build` runs `wasm/build.sh` (both `.wasm` modules into `dist/wasm/`) and `tsc`. After
changing only TypeScript, `npm run build:ts` is enough.

The Web UI button needs the web UI built for the simulator, from `web/`'s own dependencies:

```bash
(cd ../web && npm ci)
```

```bash
npm run build:webui
```

That builds `web/` with its Vite config into `dist/webui/`, with relative asset paths, routes in the
URL fragment (`#/settings`) and a small bridge that sends `/api` requests and the `/ws` socket to the
simulator tab instead of the network.

## Run

```bash
npm start
```

Open http://localhost:8765/. The display boots to standby: tap it to wake, wait for the boiler to
reach temperature (Max speed helps), then press play on the screen or flip the brew switch.
Pressing the screen runs the clock at 1× so taps register as they would on the device.

**Web UI** opens the web UI in a new tab, connected to this simulator: the dashboard, profiles,
settings and shot history all come from the display firmware. The machine keeps running while the
simulator tab is in the background; closing or reloading the simulator tab disconnects it until the
simulator is back.

## Test

```bash
npm test
```

Runs `test/sim.test.mjs` headless in Node against the same `.wasm` files: boot and link, the web
server's HTTP API and WebSocket, a full Default shot, puck density and erosion. To print a whole shot as a table:

```bash
node scripts/shot.mjs
```

Environment: `DENSITY` (g/ml), `EROSION`, `HEAT_S` (heat-up seconds before the shot), `LOGS`
(number of firmware log lines to print).

## Publish

```bash
npm run publish:pages
```

Puts `index.html`, the compiled TypeScript, `dist/wasm` and `dist/webui` on the `gh-pages` branch of
`origin` (force-pushed, one generated commit) for GitHub Pages at `https://<owner>.github.io/<repo>/`.
Run `npm run build` and `npm run build:webui` first. The first time, set the repository's Pages source to the `gh-pages` branch
if GitHub doesn't pick it up on its own.

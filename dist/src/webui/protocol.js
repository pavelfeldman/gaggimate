// Messages between a web UI tab (bridge.ts, inlined into dist/webui/index.html) and the simulator
// tab that serves it (ui/WebUiHost.ts), over a BroadcastChannel. Each simulator tab has a session
// id, passed to the web UI as ?sim=…, so several simulators can be open at once.
export const WEBUI_CHANNEL = 'gaggimate-websim';
//# sourceMappingURL=protocol.js.map
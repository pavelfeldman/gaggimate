// Messages between a web UI tab (bridge.ts, inlined into dist/webui/index.html) and the simulator
// tab that serves it (ui/WebUiHost.ts), over a BroadcastChannel. Each simulator tab has a session
// id, passed to the web UI as ?sim=…, so several simulators can be open at once.

export const WEBUI_CHANNEL = 'gaggimate-websim';

export type ToSimulator =
  | { sim: string; kind: 'hello' } // a web UI tab looking for its simulator
  | { sim: string; kind: 'fetch'; id: string; method: string; url: string; headers: Record<string, string>; body: ArrayBuffer | null }
  | { sim: string; kind: 'ws-open'; id: string; path: string }
  | { sim: string; kind: 'ws-send'; id: string; data: string }
  | { sim: string; kind: 'ws-close'; id: string };

export type ToWebUi =
  | { sim: string; kind: 'ready'; boot: string } // answer to hello, and sent on every boot; a new boot id means earlier sockets are gone
  | { sim: string; kind: 'fetch-done'; id: string; status: number; headers: Record<string, string>; body: ArrayBuffer }
  | { sim: string; kind: 'fetch-failed'; id: string; message: string }
  | { sim: string; kind: 'ws-opened'; id: string }
  | { sim: string; kind: 'ws-message'; id: string; data: string }
  | { sim: string; kind: 'ws-closed'; id: string };

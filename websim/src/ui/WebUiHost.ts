// Serves web UI tabs (dist/webui, opened from the Web UI button) from this simulator tab: their
// fetch('/api/…') calls and /ws socket arrive over a BroadcastChannel (webui/bridge.ts) and go to
// the display firmware's web server through Simulation.web.
import type { Simulation } from '../host/Simulation.js';
import type { WebSocketSession } from '../host/WebServerBridge.js';
import { WEBUI_CHANNEL } from '../webui/protocol.js';
import type { ToSimulator, ToWebUi } from '../webui/protocol.js';

const SESSION_KEY = 'gaggimate-websim-session';

export class WebUiHost {
  /** This tab's id; it survives reloads so open web UI tabs find the simulator again. */
  readonly session = WebUiHost.sessionId();
  private readonly channel = new BroadcastChannel(WEBUI_CHANNEL);
  private readonly sockets = new Map<string, WebSocketSession>();
  private sim: Simulation | null = null;
  private boot = '';

  constructor() {
    this.channel.onmessage = (event: MessageEvent<ToSimulator>) => this.receive(event.data);
  }

  /** Serves `sim` from now on; web UI tabs drop their sockets to the previous one and reconnect. */
  attach(sim: Simulation): void {
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.sim = sim;
    this.boot = Math.random().toString(36).slice(2);
    this.post({ sim: this.session, kind: 'ready', boot: this.boot });
  }

  url(): string {
    return new URL(`../../webui/index.html?sim=${encodeURIComponent(this.session)}`, import.meta.url).href;
  }

  private receive(m: ToSimulator): void {
    const sim = this.sim;
    if (m.sim !== this.session || !sim) return;
    const session = this.session;
    switch (m.kind) {
      case 'hello':
        this.post({ sim: session, kind: 'ready', boot: this.boot });
        break;
      case 'fetch':
        sim.web.request({ method: m.method, url: m.url, headers: m.headers, body: m.body ? new Uint8Array(m.body) : null }).then(
          r => this.post({ sim: session, kind: 'fetch-done', id: m.id, status: r.status, headers: r.headers, body: r.body.slice().buffer }),
          (e: unknown) => this.post({ sim: session, kind: 'fetch-failed', id: m.id, message: String(e) }),
        );
        break;
      case 'ws-open': {
        const socket = sim.web.openSocket(m.path, {
          open: () => this.post({ sim: session, kind: 'ws-opened', id: m.id }),
          message: data => this.post({ sim: session, kind: 'ws-message', id: m.id, data }),
          close: () => {
            if (this.sockets.get(m.id) === socket) this.sockets.delete(m.id);
            this.post({ sim: session, kind: 'ws-closed', id: m.id });
          },
        });
        this.sockets.set(m.id, socket);
        break;
      }
      case 'ws-send':
        this.sockets.get(m.id)?.send(m.data);
        break;
      case 'ws-close':
        this.sockets.get(m.id)?.close();
        this.sockets.delete(m.id);
        break;
    }
  }

  private post(message: ToWebUi): void {
    this.channel.postMessage(message);
  }

  private static sessionId(): string {
    const fresh = Math.random().toString(36).slice(2, 10);
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) return saved;
      sessionStorage.setItem(SESSION_KEY, fresh);
    } catch {
      // storage blocked: a per-load id still works, open web UI tabs just won't survive a reload
    }
    return fresh;
  }
}

// Runs in the web UI tab ahead of the app (scripts/build-webui.mjs inlines it into
// dist/webui/index.html). On the device the web UI talks to the display over fetch('/api/…') and a
// WebSocket on /ws; here both go over a BroadcastChannel to the simulator tab that opened it
// (ui/WebUiHost.ts), which feeds them to the display firmware's own web server.
import { WEBUI_CHANNEL } from './protocol.js';
const FETCH_TIMEOUT_MS = 20000; // a paused simulator answers nothing
const OPEN_TIMEOUT_MS = 5000;
const NOT_FOUND_BANNER_MS = 3000;
const sim = new URLSearchParams(location.search).get('sim') ?? '';
const channel = new BroadcastChannel(WEBUI_CHANNEL);
const post = (message) => channel.postMessage(message);
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fetches = new Map();
const sockets = new Map();
let boot = null;
channel.onmessage = (event) => {
    const m = event.data;
    if (m.sim !== sim)
        return;
    switch (m.kind) {
        case 'ready':
            // A new boot means the firmware that held our sockets is gone; closing them makes the app reconnect.
            if (boot !== null && boot !== m.boot)
                for (const socket of [...sockets.values()])
                    socket.finish(1006);
            boot = m.boot;
            banner(false);
            break;
        case 'fetch-done': {
            const pending = fetches.get(m.id);
            fetches.delete(m.id);
            const empty = m.status === 204 || m.status === 304;
            pending?.resolve(new Response(empty ? null : m.body, { status: m.status, headers: m.headers }));
            break;
        }
        case 'fetch-failed':
            fetches.get(m.id)?.reject(new TypeError(`Failed to fetch: ${m.message}`));
            fetches.delete(m.id);
            break;
        case 'ws-opened':
            sockets.get(m.id)?.opened();
            break;
        case 'ws-message':
            sockets.get(m.id)?.message(m.data);
            break;
        case 'ws-closed':
            sockets.get(m.id)?.finish(1000);
            break;
    }
};
// ---- fetch ---------------------------------------------------------------------------------------
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
        return nativeFetch(input, init);
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
    const id = newId();
    return new Promise((resolve, reject) => {
        const settle = () => {
            clearTimeout(timer);
            fetches.delete(id);
        };
        const timer = setTimeout(() => {
            settle();
            reject(new TypeError('Failed to fetch: the simulator did not answer'));
        }, FETCH_TIMEOUT_MS);
        fetches.set(id, {
            resolve: r => (settle(), resolve(r)),
            reject: e => (settle(), reject(e)),
        });
        request.signal.addEventListener('abort', () => {
            settle();
            reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        post({ sim, kind: 'fetch', id, method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers), body });
    });
};
// ---- WebSocket -----------------------------------------------------------------------------------
const NativeWebSocket = window.WebSocket;
class SimulatorWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    CONNECTING = 0;
    OPEN = 1;
    CLOSING = 2;
    CLOSED = 3;
    url;
    protocol = '';
    extensions = '';
    bufferedAmount = 0;
    binaryType = 'blob';
    readyState = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    id = newId();
    constructor(url) {
        super();
        this.url = url.href;
        sockets.set(this.id, this);
        post({ sim, kind: 'ws-open', id: this.id, path: url.pathname });
        setTimeout(() => {
            if (this.readyState === this.CONNECTING) {
                this.fire(new Event('error'));
                this.finish(1006);
            }
        }, OPEN_TIMEOUT_MS);
    }
    send(data) {
        if (this.readyState !== this.OPEN)
            throw new DOMException('WebSocket is not open', 'InvalidStateError');
        post({ sim, kind: 'ws-send', id: this.id, data: String(data) });
    }
    close() {
        if (this.readyState >= this.CLOSING)
            return;
        post({ sim, kind: 'ws-close', id: this.id });
        this.finish(1000);
    }
    opened() {
        if (this.readyState !== this.CONNECTING)
            return;
        this.readyState = this.OPEN;
        this.fire(new Event('open'));
    }
    message(data) {
        if (this.readyState === this.OPEN)
            this.fire(new MessageEvent('message', { data }));
    }
    finish(code) {
        if (this.readyState === this.CLOSED)
            return;
        this.readyState = this.CLOSED;
        sockets.delete(this.id);
        this.fire(new CloseEvent('close', { code, wasClean: code === 1000 }));
    }
    fire(event) {
        const handler = this[`on${event.type}`];
        if (typeof handler === 'function')
            handler.call(this, event);
        this.dispatchEvent(event);
    }
}
// The app connects to ws://<its own host>/ws; anything else is a real socket.
function PatchedWebSocket(url, protocols) {
    const resolved = new URL(url, location.href);
    if (resolved.host === location.host && resolved.pathname === '/ws')
        return new SimulatorWebSocket(resolved);
    return new NativeWebSocket(url, protocols);
}
Object.assign(PatchedWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
window.WebSocket = PatchedWebSocket;
// ---- simulator presence --------------------------------------------------------------------------
function banner(show) {
    const existing = document.getElementById('websim-banner');
    if (!show)
        return existing?.remove();
    if (existing || !document.body)
        return;
    const div = document.createElement('div');
    div.id = 'websim-banner';
    div.textContent = 'No simulator is serving this tab. Open the web UI from the GaggiMate simulator’s Web UI button.';
    div.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;padding:12px 16px;border-radius:8px;background:#b8572b;color:#fff;font:14px/1.4 system-ui,sans-serif';
    document.body.append(div);
}
post({ sim, kind: 'hello' });
setTimeout(() => boot === null && banner(true), NOT_FOUND_BANNER_MS);
//# sourceMappingURL=bridge.js.map
// BLE radio between the two boards. The firmware's own NanoPbComm Endpoint (framing, ACKs,
// retransmits) runs inside each module; this only models the air: advertising and connection
// setup delays, connection events every interval (tight while a shot runs, relaxed when idle,
// as the display requests), and optional datagram loss.
export const LINK_ADVERTISE = 1;
export const LINK_CONNECT = 2;
export const LINK_DISCONNECT = 3;
export const STATE_PEER_AVAILABLE = 1;
export const STATE_CONNECTED = 2;
export const DEFAULT_LINK = {
    scanDelayMs: 600,
    connectDelayMs: 400,
    activeIntervalMs: 10,
    idleIntervalMs: 40,
    lossRate: 0,
    forcedDown: false,
};
export class BleLink {
    random;
    params;
    advertising = false;
    connected = false;
    lowLatency = false;
    stats = { sent: 0, delivered: 0, lost: 0, bytes: 0 };
    queue = [];
    timers = [];
    nextEventMs = 0;
    ends = new Map();
    constructor(random, params = {}) {
        this.random = random;
        this.params = { ...DEFAULT_LINK, ...params };
    }
    attach(side, end) {
        this.ends.set(side, end);
    }
    intervalMs() {
        return this.lowLatency ? this.params.activeIntervalMs : this.params.idleIntervalMs;
    }
    send(from, bytes) {
        this.stats.sent++;
        this.stats.bytes += bytes.length;
        this.queue.push({ to: from === 'controller' ? 'display' : 'controller', bytes });
    }
    request(from, request, nowMs) {
        if (request === LINK_ADVERTISE && from === 'controller') {
            this.advertising = true;
            this.later(nowMs + this.params.scanDelayMs, () => this.publishState());
        }
        else if (request === LINK_CONNECT && from === 'display') {
            this.later(nowMs + this.params.connectDelayMs, () => {
                if (!this.advertising || this.params.forcedDown)
                    return;
                this.connected = true;
                this.nextEventMs = nowMs;
                this.publishState();
            });
        }
        else if (request === LINK_DISCONNECT) {
            this.drop();
        }
    }
    setForcedDown(down) {
        this.params.forcedDown = down;
        if (down)
            this.drop();
        else
            this.publishState();
    }
    drop() {
        if (!this.connected)
            return;
        this.connected = false;
        this.queue = [];
        this.publishState();
    }
    publishState() {
        const available = this.advertising && !this.params.forcedDown;
        const state = (available ? STATE_PEER_AVAILABLE : 0) | (this.connected ? STATE_CONNECTED : 0);
        this.ends.get('controller')?.setState(state);
        this.ends.get('display')?.setState(state);
    }
    later(at, fn) {
        this.timers.push({ at, fn });
    }
    // Runs due timers and, on connection events, delivers everything queued.
    step(nowMs) {
        for (let i = 0; i < this.timers.length;) {
            if (this.timers[i].at <= nowMs)
                this.timers.splice(i, 1)[0].fn();
            else
                i++;
        }
        if (!this.connected || nowMs < this.nextEventMs)
            return;
        this.nextEventMs = nowMs + this.intervalMs();
        const batch = this.queue;
        this.queue = [];
        for (const d of batch) {
            if (this.params.lossRate > 0 && this.random.next() < this.params.lossRate) {
                this.stats.lost++;
                continue;
            }
            this.stats.delivered++;
            this.ends.get(d.to)?.receive(d.bytes);
        }
    }
}
//# sourceMappingURL=BleLink.js.map
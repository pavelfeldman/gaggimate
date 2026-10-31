const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_END = encoder.encode('\r\n\r\n');
export class WebServerBridge {
    display;
    connections = new Map();
    constructor(display) {
        this.display = display;
    }
    /** GmHost.webSend: bytes the server wrote on `conn`. */
    received(conn, bytes) {
        this.connections.get(conn)?.data(bytes);
    }
    /** GmHost.webClose: the server closed `conn`. */
    closed(conn) {
        const connection = this.connections.get(conn);
        this.connections.delete(conn);
        connection?.closed();
    }
    /** One request on its own connection; the server answers and closes it (Connection: close). */
    request(request) {
        return new Promise((resolve, reject) => {
            let received = new Uint8Array(0);
            const conn = this.open({
                data: bytes => (received = concat(received, bytes)),
                closed: () => {
                    const response = parseResponse(received);
                    if (response)
                        resolve(response);
                    else
                        reject(new Error(`${request.method} ${request.url}: connection closed without a response`));
                },
            });
            const body = request.body ?? new Uint8Array(0);
            const headers = Object.entries(request.headers ?? {}).filter(([name]) => !/^(host|content-length)$/i.test(name));
            const head = [`${request.method} ${request.url} HTTP/1.1`, 'Host: gaggimate.local', ...headers.map(([n, v]) => `${n}: ${v}`)];
            head.push(`Content-Length: ${body.length}`, '', '');
            this.write(conn, concat(encoder.encode(head.join('\r\n')), body));
        });
    }
    /** A WebSocket session on `path`: the upgrade handshake, then text frames both ways. */
    openSocket(path, handlers) {
        let buffer = new Uint8Array(0);
        let upgraded = false;
        let ended = false;
        const conn = this.open({
            data: bytes => {
                buffer = concat(buffer, bytes);
                if (!upgraded) {
                    const end = indexOf(buffer, HEADER_END);
                    if (end < 0)
                        return;
                    const statusLine = decoder.decode(buffer.subarray(0, end)).split('\r\n')[0];
                    buffer = buffer.slice(end + HEADER_END.length);
                    if (!/^HTTP\/1\.1 101 /.test(statusLine)) {
                        this.end(conn);
                        return;
                    }
                    upgraded = true;
                    handlers.open();
                }
                for (let frame; (frame = takeFrame(buffer));) {
                    buffer = frame.rest;
                    if (frame.opcode === 0x1)
                        handlers.message(decoder.decode(frame.payload));
                    else if (frame.opcode === 0x8)
                        this.end(conn);
                }
            },
            closed: () => handlers.close(),
        });
        const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
        const handshake = [`GET ${path} HTTP/1.1`, 'Host: gaggimate.local', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''];
        this.write(conn, encoder.encode(handshake.join('\r\n')));
        return {
            send: text => {
                if (upgraded && !ended)
                    this.write(conn, textFrame(encoder.encode(text)));
            },
            close: () => {
                if (ended)
                    return;
                ended = true;
                this.end(conn);
            },
        };
    }
    open(connection) {
        const conn = this.display()._gm_web_open();
        this.connections.set(conn, connection);
        return conn;
    }
    write(conn, bytes) {
        if (!bytes.length)
            return;
        const module = this.display();
        const ptr = module._malloc(bytes.length);
        module.HEAPU8.set(bytes, ptr);
        module._gm_web_write(conn, ptr, bytes.length);
        module._free(ptr);
    }
    end(conn) {
        if (this.connections.has(conn))
            this.display()._gm_web_end(conn);
    }
}
function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
function indexOf(haystack, needle) {
    outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++)
            if (haystack[i + j] !== needle[j])
                continue outer;
        return i;
    }
    return -1;
}
function parseResponse(bytes) {
    const end = indexOf(bytes, HEADER_END);
    if (end < 0)
        return null;
    const [statusLine, ...lines] = decoder.decode(bytes.subarray(0, end)).split('\r\n');
    const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(statusLine)?.[1]);
    if (!status)
        return null;
    const headers = {};
    for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon > 0)
            headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const body = bytes.slice(end + HEADER_END.length);
    const length = Number(headers['content-length'] ?? body.length);
    return { status, headers, body: body.subarray(0, length) };
}
// Server frames are unmasked and never fragmented (sim/web/ESPAsyncWebServer.cpp sendWsFrame).
function takeFrame(bytes) {
    if (bytes.length < 2)
        return null;
    let length = bytes[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (bytes.length < 4)
            return null;
        length = (bytes[2] << 8) | bytes[3];
        offset = 4;
    }
    else if (length === 127) {
        if (bytes.length < 10)
            return null;
        length = 0;
        for (let i = 2; i < 10; i++)
            length = length * 256 + bytes[i];
        offset = 10;
    }
    if (bytes.length < offset + length)
        return null;
    return { opcode: bytes[0] & 0x0f, payload: bytes.slice(offset, offset + length), rest: bytes.slice(offset + length) };
}
// The server accepts unmasked client frames, so none are masked here.
function textFrame(payload) {
    const n = payload.length;
    const head = n < 126 ? [0x81, n] : n < 65536 ? [0x81, 126, n >> 8, n & 0xff] : [0x81, 127, 0, 0, 0, 0, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    return concat(Uint8Array.from(head), payload);
}
//# sourceMappingURL=WebServerBridge.js.map
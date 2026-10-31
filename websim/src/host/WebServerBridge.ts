// Host side of the display's in-memory web server connections (wasm/display/WebTransport.cpp).
// Turns fetch-style requests and WebSocket sessions into the HTTP/1.1 and RFC 6455 bytes the
// firmware's server (sim/web/ESPAsyncWebServer) parses, and parses what it sends back. The firmware
// serves connections from its loop task, so answers only arrive while virtual time runs.
import type { DisplayModule } from './WasmBoard.js';

export interface HttpRequest {
  method: string;
  url: string; // path + query
  headers?: Record<string, string>;
  body?: Uint8Array | null;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>; // lowercased names
  body: Uint8Array;
}

export interface WebSocketSession {
  send(text: string): void;
  close(): void;
}

export interface WebSocketHandlers {
  open(): void;
  message(text: string): void;
  close(): void;
}

interface Connection {
  data(bytes: Uint8Array): void;
  closed(): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_END = encoder.encode('\r\n\r\n');

export class WebServerBridge {
  private readonly connections = new Map<number, Connection>();

  constructor(private readonly display: () => DisplayModule) {}

  /** GmHost.webSend: bytes the server wrote on `conn`. */
  received(conn: number, bytes: Uint8Array): void {
    this.connections.get(conn)?.data(bytes);
  }

  /** GmHost.webClose: the server closed `conn`. */
  closed(conn: number): void {
    const connection = this.connections.get(conn);
    this.connections.delete(conn);
    connection?.closed();
  }

  /** One request on its own connection; the server answers and closes it (Connection: close). */
  request(request: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      let received: Uint8Array = new Uint8Array(0);
      const conn = this.open({
        data: bytes => (received = concat(received, bytes)),
        closed: () => {
          const response = parseResponse(received);
          if (response) resolve(response);
          else reject(new Error(`${request.method} ${request.url}: connection closed without a response`));
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
  openSocket(path: string, handlers: WebSocketHandlers): WebSocketSession {
    let buffer: Uint8Array = new Uint8Array(0);
    let upgraded = false;
    let ended = false;
    const conn = this.open({
      data: bytes => {
        buffer = concat(buffer, bytes);
        if (!upgraded) {
          const end = indexOf(buffer, HEADER_END);
          if (end < 0) return;
          const statusLine = decoder.decode(buffer.subarray(0, end)).split('\r\n')[0];
          buffer = buffer.slice(end + HEADER_END.length);
          if (!/^HTTP\/1\.1 101 /.test(statusLine)) {
            this.end(conn);
            return;
          }
          upgraded = true;
          handlers.open();
        }
        for (let frame; (frame = takeFrame(buffer)); ) {
          buffer = frame.rest;
          if (frame.opcode === 0x1) handlers.message(decoder.decode(frame.payload));
          else if (frame.opcode === 0x8) this.end(conn);
        }
      },
      closed: () => handlers.close(),
    });
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const handshake = [`GET ${path} HTTP/1.1`, 'Host: gaggimate.local', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''];
    this.write(conn, encoder.encode(handshake.join('\r\n')));
    return {
      send: text => {
        if (upgraded && !ended) this.write(conn, textFrame(encoder.encode(text)));
      },
      close: () => {
        if (ended) return;
        ended = true;
        this.end(conn);
      },
    };
  }

  private open(connection: Connection): number {
    const conn = this.display()._gm_web_open();
    this.connections.set(conn, connection);
    return conn;
  }

  private write(conn: number, bytes: Uint8Array): void {
    if (!bytes.length) return;
    const module = this.display();
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    module._gm_web_write(conn, ptr, bytes.length);
    module._free(ptr);
  }

  private end(conn: number): void {
    if (this.connections.has(conn)) this.display()._gm_web_end(conn);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function parseResponse(bytes: Uint8Array): HttpResponse | null {
  const end = indexOf(bytes, HEADER_END);
  if (end < 0) return null;
  const [statusLine, ...lines] = decoder.decode(bytes.subarray(0, end)).split('\r\n');
  const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(statusLine)?.[1]);
  if (!status) return null;
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const body = bytes.slice(end + HEADER_END.length);
  const length = Number(headers['content-length'] ?? body.length);
  return { status, headers, body: body.subarray(0, length) };
}

// Server frames are unmasked and never fragmented (sim/web/ESPAsyncWebServer.cpp sendWsFrame).
function takeFrame(bytes: Uint8Array): { opcode: number; payload: Uint8Array; rest: Uint8Array } | null {
  if (bytes.length < 2) return null;
  let length = bytes[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (bytes.length < 4) return null;
    length = (bytes[2] << 8) | bytes[3];
    offset = 4;
  } else if (length === 127) {
    if (bytes.length < 10) return null;
    length = 0;
    for (let i = 2; i < 10; i++) length = length * 256 + bytes[i];
    offset = 10;
  }
  if (bytes.length < offset + length) return null;
  return { opcode: bytes[0] & 0x0f, payload: bytes.slice(offset, offset + length), rest: bytes.slice(offset + length) };
}

// The server accepts unmasked client frames, so none are masked here.
function textFrame(payload: Uint8Array): Uint8Array {
  const n = payload.length;
  const head = n < 126 ? [0x81, n] : n < 65536 ? [0x81, 126, n >> 8, n & 0xff] : [0x81, 127, 0, 0, 0, 0, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return concat(Uint8Array.from(head), payload);
}

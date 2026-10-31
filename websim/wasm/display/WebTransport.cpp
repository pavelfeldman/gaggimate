// In-memory connections under the display's web server (sim/web/ESPAsyncWebServer): the host
// (src/host/WebServerBridge.ts) opens one per HTTP request or WebSocket from the browser tab
// running the web UI and writes the raw HTTP/1.1 and WebSocket bytes a TCP peer would send. The
// server answers through gm_hal_web_send and ends connections with gm_hal_web_close. It parses and
// answers from the Arduino loop task between loop() iterations, as sim/main.cpp pumps its sockets,
// so handlers never run outside a firmware task.
#include "gm_hal.h"
#include <ESPAsyncWebServer.h>
#include <algorithm>
#include <cstring>
#include <deque>
#include <emscripten.h>
#include <map>
#include <string>

namespace {

constexpr int LISTENER = 1;

class MemoryTransport : public AsyncWebTransport {
  public:
    MemoryTransport() { gm_web_set_transport(this); }

    int open() {
        const int id = nextId++;
        conns[id];
        pending.push_back(id);
        return id;
    }
    void write(int id, const uint8_t *data, size_t len) {
        auto it = conns.find(id);
        if (it != conns.end())
            it->second.in.append(reinterpret_cast<const char *>(data), len);
    }
    void end(int id) {
        auto it = conns.find(id);
        if (it != conns.end())
            it->second.peerClosed = true;
    }

    int listen(uint16_t) override { return LISTENER; }
    int accept(int) override {
        if (pending.empty())
            return -1;
        const int id = pending.front();
        pending.pop_front();
        return id;
    }
    long receive(int id, char *buf, size_t len) override {
        auto it = conns.find(id);
        if (it == conns.end())
            return 0;
        std::string &in = it->second.in;
        if (in.empty())
            return it->second.peerClosed ? 0 : -1;
        const size_t n = std::min(len, in.size());
        memcpy(buf, in.data(), n);
        in.erase(0, n);
        return static_cast<long>(n);
    }
    void send(int id, const void *data, size_t len) override {
        if (conns.count(id))
            gm_hal_web_send(id, static_cast<const uint8_t *>(data), static_cast<int>(len));
    }
    void close(int id) override {
        if (conns.erase(id))
            gm_hal_web_close(id);
    }

  private:
    struct Conn {
        std::string in;
        bool peerClosed = false;
    };
    std::map<int, Conn> conns;
    std::deque<int> pending;
    int nextId = LISTENER + 1;
};

// Constructed before setup() runs, so the server's begin() already listens here.
MemoryTransport g_transport;

} // namespace

// Called by the Arduino loop task after every loop() (wasm/platform/arduino_main.cpp).
void gm_after_loop() { gm_web_pump(); }

extern "C" {

// Host: a new connection, accepted on the server's next pump.
EMSCRIPTEN_KEEPALIVE int gm_web_open(void) { return g_transport.open(); }

// Host: bytes from the peer (copied; the caller keeps ownership of `data`).
EMSCRIPTEN_KEEPALIVE void gm_web_write(int conn, const uint8_t *data, int length) { g_transport.write(conn, data, length); }

// Host: the peer closed its end; the server sees EOF once it has read what was written.
EMSCRIPTEN_KEEPALIVE void gm_web_end(int conn) { g_transport.end(conn); }

} // extern "C"

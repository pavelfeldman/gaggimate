#include "WasmBleTransport.h"
#include "gm_hal.h"

#include <emscripten.h>

namespace {
WasmLinkTransport *g_instance = nullptr;
constexpr uint32_t CONNECT_TIMEOUT_MS = 5000;
} // namespace

WasmLinkTransport::WasmLinkTransport() { g_instance = this; }

WasmLinkTransport *WasmLinkTransport::instance() { return g_instance; }

void WasmLinkTransport::startHostTask(const char *name) {
    if (_task == nullptr)
        xTaskCreatePinnedToCore(hostTask, name, 4096, this, 5, &_task, 0);
    if (!_events.empty())
        xTaskNotifyGive(_task); // state the host pushed before init()
}

bool WasmLinkTransport::send(const uint8_t *data, size_t length) {
    if (!_connected)
        return false;
    gm_hal_link_send(data, static_cast<int>(length));
    return true;
}

void WasmLinkTransport::hostReceive(const uint8_t *data, size_t length) {
    _events.push_back(HostEvent{true, false, std::vector<uint8_t>(data, data + length)});
    if (_task)
        xTaskNotifyGive(_task);
}

void WasmLinkTransport::hostState(int state) {
    _peerAvailable = (state & GM_LINK_STATE_PEER_AVAILABLE) != 0;
    const bool connected = (state & GM_LINK_STATE_CONNECTED) != 0;
    _events.push_back(HostEvent{false, connected, {}});
    if (_task)
        xTaskNotifyGive(_task);
}

void WasmLinkTransport::hostTask(void *arg) {
    auto *self = static_cast<WasmLinkTransport *>(arg);
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        while (!self->_events.empty()) {
            HostEvent event = std::move(self->_events.front());
            self->_events.pop_front();
            if (event.isData) {
                self->emitData(event.data.data(), event.data.size());
            } else if (event.connected != self->_connected) {
                self->_connected = event.connected;
                self->emitConnection(event.connected);
                self->onConnectionEvent(event.connected);
            }
        }
    }
}

void BleServerTransport::init(const String &deviceName, bool pairingWindow) {
    (void)pairingWindow;
    _deviceName = deviceName;
    startHostTask("BleServerHost");
    startAdvertising();
}

void BleServerTransport::startAdvertising() { gm_hal_link_request(GM_LINK_ADVERTISE); }

void BleServerTransport::disconnect() { gm_hal_link_request(GM_LINK_DISCONNECT); }

BleClientTransport::BleClientTransport() { _connectedSem = xSemaphoreCreateBinary(); }

void BleClientTransport::init(const String &deviceName) {
    (void)deviceName;
    startHostTask("BleClientHost");
}

bool BleClientTransport::connectToServer() {
    if (_connected)
        return true;
    if (!_peerAvailable)
        return false;
    _connecting = true;
    xSemaphoreTake(_connectedSem, 0); // drop a stale give
    gm_hal_link_request(GM_LINK_CONNECT);
    const bool ok = xSemaphoreTake(_connectedSem, pdMS_TO_TICKS(CONNECT_TIMEOUT_MS)) == pdTRUE;
    _connecting = false;
    return ok && _connected;
}

void BleClientTransport::onConnectionEvent(bool connected) {
    if (connected && _connecting)
        xSemaphoreGive(_connectedSem);
}

void BleClientTransport::disconnect() { gm_hal_link_request(GM_LINK_DISCONNECT); }

void BleClientTransport::setLowLatency(bool active) { gm_hal_link_low_latency(active ? 1 : 0); }

extern "C" {

// Host: a datagram from the peer arrived. `data` is a malloc'd buffer the host filled; freed here.
EMSCRIPTEN_KEEPALIVE void gm_link_receive(uint8_t *data, int length) {
    if (WasmLinkTransport *t = WasmLinkTransport::instance())
        t->hostReceive(data, static_cast<size_t>(length));
    free(data);
}

// Host: link state changed (GM_LINK_STATE_* bits).
EMSCRIPTEN_KEEPALIVE void gm_link_state(int state) {
    if (WasmLinkTransport *t = WasmLinkTransport::instance())
        t->hostState(state);
}

} // extern "C"

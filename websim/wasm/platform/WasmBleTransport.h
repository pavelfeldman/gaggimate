// Simulator stand-ins for lib/NanoPbComm/src/ble/Ble{Client,Server}Transport: same class names and
// the API the GaggiMateClient/GaggiMateServer facades call, but datagrams go to the host's link
// model instead of NimBLE. Received datagrams and connection changes are delivered on a dedicated
// task, like NimBLE's host task, so the real Endpoint sees the same threading shape.
#pragma once

#include "Transport.h"
#include <Arduino.h>
#include <ble/BleConstants.h>
#include <deque>
#include <freertos/semphr.h>
#include <functional>
#include <vector>

// The firmware uses unqualified `vector` in some signatures; on device the NimBLE headers pull it in.
using std::vector;

// Minimal stand-in for the NimBLE client handle the display reads link status from.
class NimBLEClient {
  public:
    explicit NimBLEClient(const bool *connected) : _connected(connected) {}
    bool isConnected() const { return *_connected; }
    int getRssi() const { return -50; }

  private:
    const bool *_connected;
};

class WasmLinkTransport : public Transport {
  public:
    bool send(const uint8_t *data, size_t length) override;
    bool isConnected() const override { return _connected; }
    size_t maxDatagram() const override { return BLE_MAX_DATAGRAM; }

    // Host -> transport (via gm_link_receive / gm_link_state exports).
    void hostReceive(const uint8_t *data, size_t length);
    void hostState(int state);

    static WasmLinkTransport *instance();

  protected:
    WasmLinkTransport();
    void startHostTask(const char *name);
    virtual void onConnectionEvent(bool connected) { (void)connected; }

    bool _connected = false;
    bool _peerAvailable = false;

  private:
    struct HostEvent {
        bool isData;
        bool connected;
        std::vector<uint8_t> data;
    };
    static void hostTask(void *arg);
    std::deque<HostEvent> _events;
    TaskHandle_t _task = nullptr;
};

class BleServerTransport : public WasmLinkTransport {
  public:
    BleServerTransport() = default;
    void init(const String &deviceName, bool pairingWindow = false);
    void startAdvertising();
    void setInfo(const String &info) { _info = info; }
    bool isUpdating() const { return false; }
    void disconnect();
    void clearBonds() {}

  private:
    String _info;
    String _deviceName;
};

class BleClientTransport : public WasmLinkTransport {
  public:
    BleClientTransport();
    void init(const String &deviceName);
    void scan() {}
    void maintain() {}
    // Blocks the calling task until connected (or a timeout), like the NimBLE connect + discovery.
    bool connectToServer();
    bool isReadyForConnection() const { return _peerAvailable && !_connected; }
    void disconnect();
    void clearBonds() {}
    void setLowLatency(bool active);
    NimBLEClient *getNativeClient() const { return &_nativeClient; }
    void onIncompatible(std::function<void(const String &info)> cb) { _onIncompatible = std::move(cb); }

  protected:
    void onConnectionEvent(bool connected) override;

  private:
    SemaphoreHandle_t _connectedSem = nullptr;
    bool _connecting = false;
    mutable NimBLEClient _nativeClient{&_connected};
    std::function<void(const String &info)> _onIncompatible = nullptr;
};

// I²C (Wire) for the WASM simulator: an empty bus. Every address NACKs, so probes for the
// LED/ToF accessory and the gear-pump extension fail and the firmware takes its fallbacks.
#pragma once

#include <Arduino.h>

class TwoWire : public Stream {
  public:
    explicit TwoWire(uint8_t bus = 0) : _bus(bus) {}
    bool begin(int sda = -1, int scl = -1, uint32_t frequency = 0) {
        (void)sda;
        (void)scl;
        (void)frequency;
        return true;
    }
    bool end() { return true; }
    void setClock(uint32_t) {}
    void setTimeOut(uint16_t) {}
    void beginTransmission(uint16_t address) { (void)address; }
    void beginTransmission(int address) { (void)address; }
    uint8_t endTransmission(bool sendStop = true) {
        (void)sendStop;
        return 2; // NACK on address
    }
    uint8_t requestFrom(uint16_t address, uint8_t size, bool sendStop = true) {
        (void)address;
        (void)size;
        (void)sendStop;
        return 0;
    }
    uint8_t requestFrom(int address, int size) { return requestFrom(static_cast<uint16_t>(address), static_cast<uint8_t>(size)); }
    size_t write(uint8_t) override { return 1; }
    size_t write(const uint8_t *, size_t size) override { return size; }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override {}

  private:
    uint8_t _bus;
};

extern TwoWire Wire;
extern TwoWire Wire1;

// Stand-in for stevemarple/SoftWire on the WASM simulator: an idle, empty bit-banged bus
// (lines read high, every address NACKs).
#pragma once

#include <Arduino.h>

class SoftWire : public Stream {
  public:
    SoftWire(uint8_t sda, uint8_t scl) : _sda(sda), _scl(scl) {}

    void setTxBuffer(void *buffer, size_t size) {
        (void)buffer;
        (void)size;
    }
    void setRxBuffer(void *buffer, size_t size) {
        (void)buffer;
        (void)size;
    }
    void setTimeout_ms(uint16_t ms) { (void)ms; }
    void setDelay_us(uint16_t us) { (void)us; }
    void setClock(uint32_t frequency) { (void)frequency; }
    // Pin-access hooks (used to route the bus through an IO expander).
    template <typename F> void setReadSda(F) {}
    template <typename F> void setReadScl(F) {}
    template <typename F> void setSetSdaHigh(F) {}
    template <typename F> void setSetSdaLow(F) {}
    template <typename F> void setSetSclHigh(F) {}
    template <typename F> void setSetSclLow(F) {}
    void begin() {}
    void end() {}

    void beginTransmission(uint8_t address) { (void)address; }
    uint8_t endTransmission(uint8_t sendStop = 1) {
        (void)sendStop;
        return 2; // NACK on address
    }
    uint8_t requestFrom(uint8_t address, uint8_t quantity, uint8_t sendStop = 1) {
        (void)address;
        (void)quantity;
        (void)sendStop;
        return 0;
    }
    void stop(bool allowClockStretch = true) { (void)allowClockStretch; }

    size_t write(uint8_t) override { return 1; }
    size_t write(const uint8_t *, size_t size) override { return size; }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override {}

    static void sdaHigh(const SoftWire *) {}
    static void sdaLow(const SoftWire *) {}
    static void sclHigh(const SoftWire *) {}
    static void sclLow(const SoftWire *) {}
    static uint8_t readSda(const SoftWire *) { return HIGH; }
    static uint8_t readScl(const SoftWire *) { return HIGH; }

  private:
    uint8_t _sda;
    uint8_t _scl;
};

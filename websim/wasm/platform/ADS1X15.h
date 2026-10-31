// Stand-in for robtillaart/ADS1X15 (ADS1115 subset ADSAdc uses), sampling the simulated board.
// Single-shot conversions: requestADC() latches the channel voltage, isReady() turns true after
// one conversion time at the configured data rate, getValue() returns the 16-bit result.
#pragma once

#include "gm_hal.h"
#include <Arduino.h>
#include <Wire.h>
#include <cmath>

#define ADS1X15_OK 0
#define ADS1X15_INVALID_VOLTAGE -100
#define ADS1X15_INVALID_GAIN 0xFF
#define ADS1X15_INVALID_MODE 0xFE

class ADS1115 {
  public:
    explicit ADS1115(uint8_t address = 0x48, TwoWire *wire = &Wire) : _address(address) { (void)wire; }

    bool begin() { return true; }
    bool isConnected() { return true; }

    // Gain 0 = ±6.144 V full scale (the only setting the firmware uses).
    void setGain(uint8_t gain) { _gain = gain; }
    uint8_t getGain() { return _gain; }
    // Data rate index 0..7 -> 8, 16, 32, 64, 128, 250, 475, 860 SPS.
    void setDataRate(uint8_t rate) { _rate = rate > 7 ? 7 : rate; }
    uint8_t getDataRate() { return _rate; }
    void setMode(uint8_t mode) { _mode = mode; }

    int8_t getError() { return ADS1X15_OK; }

    void requestADC(int pin) {
        const double volts = gm_hal_adc_volts(pin);
        const double counts = std::round(volts / fullScale() * 32767.0);
        _latched = static_cast<int16_t>(counts > 32767 ? 32767 : counts < -32768 ? -32768 : counts);
        _requestedUs = micros();
        _pending = true;
    }

    bool isBusy() { return !isReady(); }
    bool isReady() { return !_pending || micros() - _requestedUs >= conversionUs(); }

    int16_t getValue() {
        _pending = false;
        return _latched;
    }

    int16_t readADC(uint8_t pin) {
        requestADC(pin);
        return getValue();
    }

    float toVoltage(int16_t raw) { return raw * fullScale() / 32767.0; }

  private:
    double fullScale() const {
        static const double FSR[] = {6.144, 4.096, 2.048, 1.024, 0.512, 0.256};
        return _gain < 6 ? FSR[_gain] : 6.144;
    }
    unsigned long conversionUs() const {
        static const unsigned SPS[] = {8, 16, 32, 64, 128, 250, 475, 860};
        return 1000000UL / SPS[_rate] + 1;
    }

    uint8_t _address;
    uint8_t _gain = 0;
    uint8_t _rate = 4;
    uint8_t _mode = 1;
    int16_t _latched = 0;
    unsigned long _requestedUs = 0;
    bool _pending = false;
};

// Stand-in for robtillaart/MAX31855 (the subset Max31855Thermocouple uses), reading the simulated
// thermocouple. The real chip resolves 0.25 °C; an open circuit reports a fault status.
#pragma once

#include "gm_hal.h"
#include <Arduino.h>
#include <cmath>

#define STATUS_OK 0x00
#define STATUS_OPEN_CIRCUIT 0x01
#define STATUS_SHORT_TO_GND 0x02
#define STATUS_SHORT_TO_VCC 0x04
#define STATUS_ERROR 0x07
#define STATUS_NOREAD 0x80
#define STATUS_NO_COMMUNICATION 0x81

class MAX31855 {
  public:
    MAX31855(uint8_t select, uint8_t miso, uint8_t clock) {
        (void)select;
        (void)miso;
        (void)clock;
    }
    void begin() {}
    void setSPIspeed(uint32_t speed) { (void)speed; }

    uint8_t read() {
        const double t = gm_hal_thermocouple_c();
        if (std::isnan(t)) {
            _status = STATUS_OPEN_CIRCUIT;
            return _status;
        }
        _temperature = static_cast<float>(std::round(t * 4.0) / 4.0);
        _status = STATUS_OK;
        return _status;
    }

    float getTemperature() const { return _temperature; }
    uint8_t getStatus() const { return _status; }

  private:
    float _temperature = 0.0f;
    uint8_t _status = STATUS_NOREAD;
};

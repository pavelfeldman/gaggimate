// SPI for the WASM simulator: the MAX31855 stand-in reads the thermocouple directly.
#pragma once

#include <Arduino.h>

class SPIClass {
  public:
    void begin(int8_t sck = -1, int8_t miso = -1, int8_t mosi = -1, int8_t ss = -1) {
        (void)sck;
        (void)miso;
        (void)mosi;
        (void)ss;
    }
    void end() {}
};

extern SPIClass SPI;

// Stand-in for lewisxhe/SensorLib's XL9555 IO expander: never present on the simulated bus.
#pragma once

#include <Arduino.h>

#define XL9555_SLAVE_ADDRESS0 0x20
#define XL9555_SLAVE_ADDRESS1 0x21
#define XL9555_SLAVE_ADDRESS2 0x22
#define XL9555_SLAVE_ADDRESS3 0x23
#define XL9555_SLAVE_ADDRESS4 0x24
#define XL9555_SLAVE_ADDRESS5 0x25
#define XL9555_SLAVE_ADDRESS6 0x26
#define XL9555_SLAVE_ADDRESS7 0x27

class ExtensionIOXL9555 {
  public:
    enum ExtensionGPIO { IO0, IO1, IO2, IO3, IO4, IO5, IO6, IO7, IO8, IO9, IO10, IO11, IO12, IO13, IO14, IO15 };

    template <typename... Args> bool begin(Args &&...) { return false; }
    template <typename... Args> bool init(Args &&...) { return false; }
    void setClock(uint32_t) {}
    void pinMode(uint8_t pin, uint8_t mode) {
        (void)pin;
        (void)mode;
    }
    int digitalRead(uint8_t pin) {
        (void)pin;
        return LOW;
    }
    void digitalWrite(uint8_t pin, uint8_t value) {
        (void)pin;
        (void)value;
    }
};

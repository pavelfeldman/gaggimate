// <Arduino.h> for the WASM simulator. Same vocabulary as sim/platform/Arduino.h, but GPIO,
// interrupts and time go to the simulated board (gm_hal / gm_sched) instead of being no-ops.
// Kept C-safe: LVGL's C sources include this for millis() via LV_TICK_CUSTOM.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp32-hal-log.h"
#include "esp32-hal.h"
#include "esp_log.h"
#include "esp_system.h"
#include "pgmspace.h"

typedef struct hw_timer_s hw_timer_t;

#define HIGH 1
#define LOW 0
#define INPUT 0x01
#define OUTPUT 0x03
#define PULLUP 0x04
#define INPUT_PULLUP 0x05
#define PULLDOWN 0x08
#define INPUT_PULLDOWN 0x09
#define OPEN_DRAIN 0x10
#define OUTPUT_OPEN_DRAIN 0x13
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define ONLOW 0x04
#define ONHIGH 0x05
#define NOT_AN_INTERRUPT -1
#define LSBFIRST 0
#define MSBFIRST 1
#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105

#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define _min(a, b) ((a) < (b) ? (a) : (b))
#define _max(a, b) ((a) > (b) ? (a) : (b))
#define bit(b) (1UL << (b))
#define bitRead(value, b) (((value) >> (b)) & 0x01)
#define bitSet(value, b) ((value) |= (1UL << (b)))
#define bitClear(value, b) ((value) &= ~(1UL << (b)))
#define bitWrite(value, b, bv) ((bv) ? bitSet(value, b) : bitClear(value, b))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define interrupts()
#define noInterrupts()
#define digitalPinToInterrupt(p) ((int)(p))

#ifdef __cplusplus
extern "C" {
#endif
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void attachInterrupt(uint8_t pin, void (*isr)(void), int mode);
void attachInterruptArg(uint8_t pin, void (*isr)(void *), void *arg, int mode);
void detachInterrupt(uint8_t pin);
#ifdef __cplusplus
}
#endif

#ifdef __cplusplus

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "Esp.h"
#include "IPAddress.h"
#include "Print.h"
#include "Printable.h"
#include "Stream.h"
#include "WString.h"
#include "esp_heap_caps.h"
// Arduino-ESP32's esp32-hal.h pulls these in, and firmware relies on it.
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

typedef uint8_t byte;
typedef bool boolean;
typedef uint16_t word;

using std::max;
using std::min;

inline void analogWrite(uint8_t, int) {}

inline long map(long x, long inMin, long inMax, long outMin, long outMax) {
    if (inMax == inMin)
        return outMin;
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
long random(long howbig);
inline long random(long howsmall, long howbig) { return howbig > howsmall ? howsmall + random(howbig - howsmall) : howsmall; }
inline void randomSeed(unsigned long) {}

// No SNTP in the simulator: the clock stays unsynced, as on a device without Wi-Fi.
inline void configTime(long, int, const char *, const char * = nullptr, const char * = nullptr) {}
inline void configTzTime(const char *, const char *, const char * = nullptr, const char * = nullptr) {}
inline bool getLocalTime(struct tm *info, uint32_t ms = 5000) {
    (void)info;
    (void)ms;
    return false;
}

// UART0 console: lines go to the host's board log (like the serial monitor), not through stdio.
class HardwareSerial : public Stream {
  public:
    void begin(unsigned long = 115200) {}
    void end() {}
    operator bool() const { return true; }
    size_t write(uint8_t c) override;
    size_t write(const uint8_t *buffer, size_t size) override {
        for (size_t i = 0; i < size; i++)
            write(buffer[i]);
        return size;
    }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override;

  private:
    std::string _line;
};

extern HardwareSerial Serial;

void attachInterrupt(uint8_t pin, std::function<void(void)> isr, int mode);

#endif // __cplusplus

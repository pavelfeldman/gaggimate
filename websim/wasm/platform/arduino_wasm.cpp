// Arduino core functions for the WASM simulator: virtual time from gm_sched, GPIO and interrupts
// through the host HAL. Interrupt service routines run in scheduler context when the host raises
// them (gm_interrupt).
#include "Arduino.h"
#include "gm_hal.h"
#include "gm_sched.h"

#include <cstdarg>
#include <emscripten.h>
#include <functional>
#include <map>

HardwareSerial Serial;
EspClass ESP;

size_t HardwareSerial::write(uint8_t c) {
    if (c == '\n') {
        flush();
    } else if (c != '\r') {
        _line.push_back(static_cast<char>(c));
    }
    return 1;
}

void HardwareSerial::flush() {
    gm_hal_log('S', _line.data(), static_cast<int>(_line.size()));
    _line.clear();
}

extern "C" void gm_log_printf(char level, const char *tag, const char *fmt, ...) {
    char line[512];
    int n = snprintf(line, sizeof line, "[%lu][%c][%s] ", millis(), level, tag ? tag : "");
    va_list args;
    va_start(args, fmt);
    if (n >= 0 && n < static_cast<int>(sizeof line))
        n += vsnprintf(line + n, sizeof line - n, fmt, args);
    va_end(args);
    if (n > static_cast<int>(sizeof line) - 1)
        n = sizeof line - 1;
    while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r'))
        n--;
    gm_hal_log(level, line, n < 0 ? 0 : n);
}

namespace {
std::map<uint8_t, std::function<void(void)>> g_isrs;
}

extern "C" {

unsigned long millis(void) { return static_cast<unsigned long>(gm_now_us() / 1000); }
unsigned long micros(void) { return static_cast<unsigned long>(gm_now_us()); }
int64_t esp_timer_get_time(void) { return static_cast<int64_t>(gm_now_us()); }

void delay(uint32_t ms) { gm_sleep_until(gm_now_us() + static_cast<uint64_t>(ms) * 1000); }
void delayMicroseconds(uint32_t us) { gm_sleep_until(gm_now_us() + us); }
void yield(void) { gm_sleep_until(gm_now_us()); }

void pinMode(uint8_t pin, uint8_t mode) { gm_hal_pin_mode(pin, mode); }
void digitalWrite(uint8_t pin, uint8_t value) { gm_hal_digital_write(pin, value ? HIGH : LOW); }
int digitalRead(uint8_t pin) { return gm_hal_digital_read(pin); }
int analogRead(uint8_t pin) { return gm_hal_analog_read_mv(pin) * 4095 / 3300; }
uint32_t analogReadMilliVolts(uint8_t pin) { return static_cast<uint32_t>(gm_hal_analog_read_mv(pin)); }

void attachInterrupt(uint8_t pin, void (*isr)(void), int mode) {
    (void)mode; // the host only raises the edge the firmware asked for
    g_isrs[pin] = isr;
}
void attachInterruptArg(uint8_t pin, void (*isr)(void *), void *arg, int mode) {
    (void)mode;
    g_isrs[pin] = [isr, arg]() { isr(arg); };
}
void detachInterrupt(uint8_t pin) { g_isrs.erase(pin); }

// Host: an edge on `pin` happened now.
EMSCRIPTEN_KEEPALIVE void gm_interrupt(int pin) {
    auto it = g_isrs.find(static_cast<uint8_t>(pin));
    if (it != g_isrs.end())
        it->second();
}

} // extern "C"

void attachInterrupt(uint8_t pin, std::function<void(void)> isr, int mode) {
    (void)mode;
    g_isrs[pin] = std::move(isr);
}

long random(long howbig) { return howbig ? static_cast<long>(gm_hal_random() % static_cast<uint32_t>(howbig)) : 0; }

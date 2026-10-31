// Host (JavaScript) imports: the bottom edge of the simulated board. Implemented in gm_hal.js,
// which forwards to Module.gmHost supplied by the TypeScript host at instantiation.
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void gm_hal_pin_mode(int pin, int mode);
void gm_hal_digital_write(int pin, int value);
int gm_hal_digital_read(int pin);
int gm_hal_analog_read_mv(int pin);
// ADS1115 single-ended input voltage on `channel` at this instant.
double gm_hal_adc_volts(int channel);
// MAX31855 hot-junction temperature (°C) at this instant; NaN = open circuit.
double gm_hal_thermocouple_c(void);
uint32_t gm_hal_random(void);

// BLE link: datagrams and connection control (see WasmBleTransport).
void gm_hal_link_send(const uint8_t *data, int length);
void gm_hal_link_request(int request); // GM_LINK_ADVERTISE / GM_LINK_CONNECT / GM_LINK_DISCONNECT
void gm_hal_link_low_latency(int active);

// Display web server: bytes sent on, and the end of, an in-memory connection (display/WebTransport.cpp).
void gm_hal_web_send(int conn, const uint8_t *data, int length);
void gm_hal_web_close(int conn);

// Firmware-to-host events that have no hardware equivalent (scale tare, telemetry).
void gm_hal_event(const char *name, double value);

// One log line: level 'E'/'W'/'I' from ESP_LOGx, 'S' from Serial (the board's serial monitor).
void gm_hal_log(char level, const char *line, int length);

#define GM_LINK_ADVERTISE 1
#define GM_LINK_CONNECT 2
#define GM_LINK_DISCONNECT 3

// Host -> firmware link state bits (gm_link_state export)
#define GM_LINK_STATE_PEER_AVAILABLE 1
#define GM_LINK_STATE_CONNECTED 2

#ifdef __cplusplus
}
#endif

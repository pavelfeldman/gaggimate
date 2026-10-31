// Emscripten JS library: forwards the board's HAL imports to Module.gmHost (see src/host/Board.ts).
addToLibrary({
  gm_hal_pin_mode: (pin, mode) => Module.gmHost.pinMode(pin, mode),
  gm_hal_digital_write: (pin, value) => Module.gmHost.digitalWrite(pin, value),
  gm_hal_digital_read: pin => Module.gmHost.digitalRead(pin),
  gm_hal_analog_read_mv: pin => Module.gmHost.analogReadMilliVolts(pin),
  gm_hal_adc_volts: channel => Module.gmHost.adcVolts(channel),
  gm_hal_thermocouple_c: () => Module.gmHost.thermocoupleC(),
  gm_hal_random: () => Module.gmHost.random() >>> 0,
  gm_hal_link_send: (ptr, length) => Module.gmHost.linkSend(HEAPU8.slice(ptr, ptr + length)),
  gm_hal_link_request: request => Module.gmHost.linkRequest(request),
  gm_hal_link_low_latency: active => Module.gmHost.linkLowLatency(!!active),
  gm_hal_log__deps: ['$UTF8ToString'],
  gm_hal_log: (level, ptr, length) => Module.gmHost.log(String.fromCharCode(level), UTF8ToString(ptr, length)),
  gm_hal_event__deps: ['$UTF8ToString'],
  gm_hal_event: (name, value) => Module.gmHost.event(UTF8ToString(name), value),
});

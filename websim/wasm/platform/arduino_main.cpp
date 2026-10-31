// The Arduino-ESP32 core's app_main: a "loopTask" that runs setup() once, then loop() forever.
#include <Arduino.h>
#include <emscripten.h>

void setup();
void loop();

// Board-specific work between loop() iterations: the display pumps its web server here
// (display/WebTransport.cpp), as sim/main.cpp does after each loop().
__attribute__((weak)) void gm_after_loop() {}

namespace {
void loopTask(void *) {
    setup();
    for (;;) {
        loop();
        gm_after_loop();
    }
}
} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE void gm_boot(void) { xTaskCreatePinnedToCore(loopTask, "loopTask", 8192, nullptr, 1, nullptr, 1); }

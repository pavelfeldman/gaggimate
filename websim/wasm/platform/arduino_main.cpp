// The Arduino-ESP32 core's app_main: a "loopTask" that runs setup() once, then loop() forever.
#include <Arduino.h>
#include <emscripten.h>

void setup();
void loop();

namespace {
void loopTask(void *) {
    setup();
    for (;;) {
        loop();
    }
}
} // namespace

extern "C" EMSCRIPTEN_KEEPALIVE void gm_boot(void) { xTaskCreatePinnedToCore(loopTask, "loopTask", 8192, nullptr, 1, nullptr, 1); }

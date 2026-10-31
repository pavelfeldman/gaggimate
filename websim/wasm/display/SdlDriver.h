// WASM stand-in for sim/driver/SdlDriver.h (same class, which Controller::setupPanel picks under
// GAGGIMATE_SIM). LVGL flushes into a 480×480 RGB565 framebuffer in wasm memory; the host copies
// it to a <canvas> and feeds pointer input back through gm_touch().
#pragma once

#include <display/drivers/Driver.h>
#include <stdint.h>

class SdlDriver : public Driver {
  public:
    bool isCompatible() override { return true; }
    void init() override; // LVGL display + pointer input registration
    void setBrightness(int brightness) override { _brightness = brightness; }
    bool supportsSDCard() override { return false; }
    bool installSDCard() override { return false; }

    static SdlDriver *getInstance() {
        if (instance == nullptr)
            instance = new SdlDriver();
        return instance;
    }

    int brightness() const { return _brightness; }

  private:
    static SdlDriver *instance;
    SdlDriver() = default;
    int _brightness = 16;
};

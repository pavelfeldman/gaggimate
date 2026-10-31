#include "SdlDriver.h"

#include <cstdlib>
#include <emscripten.h>
#include <lvgl.h>

SdlDriver *SdlDriver::instance = nullptr;

namespace {

// The LilyGo T-RGB panel the default UI targets is 480x480.
constexpr int DISP_W = 480;
constexpr int DISP_H = 480;

lv_disp_draw_buf_t s_drawBuf;
lv_color_t *s_buf = nullptr;
uint16_t s_framebuffer[DISP_W * DISP_H];
uint32_t s_frames = 0;
int s_touchX = 0;
int s_touchY = 0;
bool s_touchPressed = false;

void dispFlush(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_p) {
    const int w = area->x2 - area->x1 + 1;
    for (int y = area->y1; y <= area->y2; y++) {
        uint16_t *row = s_framebuffer + y * DISP_W + area->x1;
        for (int x = 0; x < w; x++)
            row[x] = color_p[x].full;
        color_p += w;
    }
    s_frames++;
    lv_disp_flush_ready(drv);
}

void pointerRead(lv_indev_drv_t *drv, lv_indev_data_t *data) {
    (void)drv;
    data->point.x = static_cast<lv_coord_t>(s_touchX);
    data->point.y = static_cast<lv_coord_t>(s_touchY);
    data->state = s_touchPressed ? LV_INDEV_STATE_PR : LV_INDEV_STATE_REL;
}

} // namespace

void SdlDriver::init() {
    lv_init();
    s_buf = static_cast<lv_color_t *>(malloc(DISP_W * DISP_H * sizeof(lv_color_t)));
    lv_disp_draw_buf_init(&s_drawBuf, s_buf, nullptr, DISP_W * DISP_H);

    static lv_disp_drv_t dispDrv;
    lv_disp_drv_init(&dispDrv);
    dispDrv.hor_res = DISP_W;
    dispDrv.ver_res = DISP_H;
    dispDrv.flush_cb = dispFlush;
    dispDrv.draw_buf = &s_drawBuf;
    lv_disp_drv_register(&dispDrv);

    static lv_indev_drv_t indevDrv;
    lv_indev_drv_init(&indevDrv);
    indevDrv.type = LV_INDEV_TYPE_POINTER;
    indevDrv.read_cb = pointerRead;
    lv_indev_drv_register(&indevDrv);
}

extern "C" {

// RGB565 pixels, row-major, 480×480.
EMSCRIPTEN_KEEPALIVE uint16_t *gm_display_framebuffer(void) { return s_framebuffer; }
// Bumps on every LVGL flush, so the host only repaints when something changed.
EMSCRIPTEN_KEEPALIVE uint32_t gm_display_frames(void) { return s_frames; }
EMSCRIPTEN_KEEPALIVE int gm_display_brightness(void) { return SdlDriver::getInstance()->brightness(); }

EMSCRIPTEN_KEEPALIVE void gm_touch(int x, int y, int pressed) {
    s_touchX = x;
    s_touchY = y;
    s_touchPressed = pressed != 0;
}

} // extern "C"

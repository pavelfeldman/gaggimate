// esp_timer on the fiber scheduler: callbacks run at their virtual due time (ESP_TIMER_TASK dispatch).
#pragma once

#include "esp_err.h"
#include <gm_sched.h>
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef gm_timer *esp_timer_handle_t;
typedef void (*esp_timer_cb_t)(void *arg);
typedef enum { ESP_TIMER_TASK, ESP_TIMER_ISR } esp_timer_dispatch_t;

typedef struct {
    esp_timer_cb_t callback;
    void *arg;
    esp_timer_dispatch_t dispatch_method;
    const char *name;
    bool skip_unhandled_events;
} esp_timer_create_args_t;

int64_t esp_timer_get_time(void);

static inline esp_err_t esp_timer_create(const esp_timer_create_args_t *args, esp_timer_handle_t *out) {
    *out = gm_timer_create(args->callback, args->arg, args->name);
    return ESP_OK;
}
static inline esp_err_t esp_timer_start_once(esp_timer_handle_t t, uint64_t timeout_us) {
    gm_timer_start(t, timeout_us, 0);
    return ESP_OK;
}
static inline esp_err_t esp_timer_start_periodic(esp_timer_handle_t t, uint64_t period_us) {
    gm_timer_start(t, period_us, period_us);
    return ESP_OK;
}
static inline esp_err_t esp_timer_stop(esp_timer_handle_t t) {
    gm_timer_stop(t);
    return ESP_OK;
}
static inline esp_err_t esp_timer_delete(esp_timer_handle_t t) {
    gm_timer_delete(t);
    return ESP_OK;
}
static inline bool esp_timer_is_active(esp_timer_handle_t t) { return gm_timer_active(t) != 0; }

#ifdef __cplusplus
}
#endif

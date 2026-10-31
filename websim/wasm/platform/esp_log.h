// esp_log.h for the WASM simulator: ESP_LOGE/W/I go to the host's per-board log as
// "[millis][L][tag] msg" (gm_log_printf). D/V are compiled out, like the firmware's CORE_DEBUG_LEVEL=3.
// Logging bypasses musl stdio so firmware output never depends on stdout buffering.
#pragma once

#include <stdio.h>

typedef enum { ESP_LOG_NONE, ESP_LOG_ERROR, ESP_LOG_WARN, ESP_LOG_INFO, ESP_LOG_DEBUG, ESP_LOG_VERBOSE } esp_log_level_t;

#ifdef __cplusplus
extern "C" {
#endif
void gm_log_printf(char level, const char *tag, const char *fmt, ...) __attribute__((format(printf, 3, 4)));
#ifdef __cplusplus
}
// Tags are sometimes an Arduino String (a static LOG_TAG), sometimes const char*.
inline const char *gm_log_tag(const char *t) { return t ? t : ""; }
template <class T> inline const char *gm_log_tag(const T &t) { return t.c_str(); }
#else
#define gm_log_tag(t) (t)
#endif

#define ESP_LOGE(tag, fmt, ...) gm_log_printf('E', gm_log_tag(tag), fmt, ##__VA_ARGS__)
#define ESP_LOGW(tag, fmt, ...) gm_log_printf('W', gm_log_tag(tag), fmt, ##__VA_ARGS__)
#define ESP_LOGI(tag, fmt, ...) gm_log_printf('I', gm_log_tag(tag), fmt, ##__VA_ARGS__)
#define ESP_LOGD(tag, fmt, ...) ((void)0)
#define ESP_LOGV(tag, fmt, ...) ((void)0)
#define ESP_EARLY_LOGE ESP_LOGE
#define ESP_EARLY_LOGW ESP_LOGW
#define ESP_EARLY_LOGI ESP_LOGI

static inline void esp_log_level_set(const char *tag, esp_log_level_t level) {
    (void)tag;
    (void)level;
}

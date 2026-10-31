// esp_system.h for the WASM simulator: esp_random() comes from the host's seeded PRNG.
#pragma once

#include "esp_err.h"
#include <stdint.h>
#include <stdlib.h>

#ifdef __cplusplus
extern "C" {
#endif

uint32_t gm_hal_random(void);
static inline uint32_t esp_random(void) { return gm_hal_random(); }
static inline uint32_t esp_get_free_heap_size(void) { return 4u * 1024u * 1024u; }
static inline uint32_t esp_get_minimum_free_heap_size(void) { return 2u * 1024u * 1024u; }
static inline void esp_restart(void) { abort(); }

#ifdef __cplusplus
}
#endif

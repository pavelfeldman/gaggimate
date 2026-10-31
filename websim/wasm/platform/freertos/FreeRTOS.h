// FreeRTOS types/constants for the WASM simulator (shadows sim/platform/freertos/FreeRTOS.h).
#pragma once

#include <stdint.h>

typedef uint32_t TickType_t;
typedef int BaseType_t;
typedef unsigned int UBaseType_t;
typedef uint32_t StackType_t;

#define pdFALSE 0
#define pdTRUE 1
#define pdPASS 1
#define pdFAIL 0
#define errQUEUE_FULL 0
#define errQUEUE_EMPTY 0
#define portMAX_DELAY ((TickType_t)0xffffffff)
#define portTICK_PERIOD_MS ((TickType_t)1)
#define portTICK_RATE_MS portTICK_PERIOD_MS
#define configTICK_RATE_HZ 1000
#define configMINIMAL_STACK_SIZE 768
#define configMAX_PRIORITIES 25
#define tskNO_AFFINITY 0x7fffffff
#define tskIDLE_PRIORITY 0
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
#define pdTICKS_TO_MS(t) ((uint32_t)(t))
#define configASSERT(x) ((void)0)

// One cooperative core: critical sections and spinlocks are no-ops.
typedef struct {
    int unused;
} portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {0}
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
#define portENTER_CRITICAL_ISR(mux) ((void)(mux))
#define portEXIT_CRITICAL_ISR(mux) ((void)(mux))
#define taskENTER_CRITICAL(mux) ((void)(mux))
#define taskEXIT_CRITICAL(mux) ((void)(mux))
#define portYIELD_FROM_ISR(...) ((void)0)
#define IRAM_ATTR

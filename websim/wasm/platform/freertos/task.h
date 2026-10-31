// FreeRTOS task API on the fiber scheduler (shadows sim/platform/freertos/task.h, whose tasks are no-ops).
#pragma once

#include "FreeRTOS.h"
#include <gm_sched.h>
#include <stdint.h>

typedef gm_task *TaskHandle_t;
typedef TaskHandle_t xTaskHandle;
typedef void (*TaskFunction_t)(void *);

typedef enum { eRunning = 0, eReady, eBlocked, eSuspended, eDeleted, eInvalid } eTaskState;

static inline TickType_t gm_ticks_now(void) { return (TickType_t)(gm_now_us() / 1000); }

static inline uint64_t gm_deadline_for(TickType_t ticks) {
    return ticks == portMAX_DELAY ? UINT64_MAX : gm_now_us() + (uint64_t)ticks * 1000;
}

static inline BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char *name, uint32_t stack, void *param,
                                                 UBaseType_t prio, TaskHandle_t *handle, BaseType_t core) {
    (void)stack;
    (void)core;
    TaskHandle_t task = gm_task_create(fn, param, name, prio);
    if (handle)
        *handle = task;
    return task ? pdPASS : pdFAIL;
}

static inline BaseType_t xTaskCreate(TaskFunction_t fn, const char *name, uint32_t stack, void *param, UBaseType_t prio,
                                     TaskHandle_t *handle) {
    return xTaskCreatePinnedToCore(fn, name, stack, param, prio, handle, tskNO_AFFINITY);
}

static inline void vTaskDelay(TickType_t ticks) { gm_sleep_until(gm_now_us() + (uint64_t)ticks * 1000); }

// Same decision as FreeRTOS tasks.c: wake at *prev + increment, no delay if that is already past.
static inline BaseType_t xTaskDelayUntil(TickType_t *prevWakeTime, TickType_t increment) {
    const TickType_t now = gm_ticks_now();
    const TickType_t wake = *prevWakeTime + increment;
    int shouldDelay;
    if (now < *prevWakeTime) // tick count wrapped since the last wake
        shouldDelay = wake < *prevWakeTime && wake > now;
    else
        shouldDelay = wake < *prevWakeTime || wake > now;
    *prevWakeTime = wake;
    if (shouldDelay) {
        gm_sleep_until((uint64_t)wake * 1000);
        return pdTRUE;
    }
    return pdFALSE;
}
static inline void vTaskDelayUntil(TickType_t *prevWakeTime, TickType_t increment) { xTaskDelayUntil(prevWakeTime, increment); }

static inline void vTaskDelete(TaskHandle_t handle) { gm_task_delete(handle); }
static inline eTaskState eTaskGetState(TaskHandle_t handle) {
    if (!gm_task_alive(handle))
        return eDeleted;
    return handle == gm_task_current() ? eRunning : eBlocked;
}
static inline TaskHandle_t xTaskGetCurrentTaskHandle(void) { return gm_task_current(); }
static inline TickType_t xTaskGetTickCount(void) { return gm_ticks_now(); }
static inline TickType_t xTaskGetTickCountFromISR(void) { return gm_ticks_now(); }
static inline const char *pcTaskGetName(TaskHandle_t handle) { return gm_task_name(handle ? handle : gm_task_current()); }
static inline void taskYIELD(void) { gm_sleep_until(gm_now_us()); }
static inline UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t) { return 4096; }

// Notifications
static inline uint32_t ulTaskNotifyTake(BaseType_t clearOnExit, TickType_t ticksToWait) {
    return gm_notify_take(clearOnExit, gm_deadline_for(ticksToWait));
}
static inline BaseType_t xTaskNotifyGive(TaskHandle_t task) {
    gm_notify_give(task);
    return pdPASS;
}
static inline void vTaskNotifyGiveFromISR(TaskHandle_t task, BaseType_t *woken) {
    gm_notify_give(task);
    if (woken)
        *woken = pdFALSE;
}

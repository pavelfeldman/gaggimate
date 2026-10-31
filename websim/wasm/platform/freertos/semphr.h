// FreeRTOS semaphores and (recursive) mutexes on the fiber scheduler.
#pragma once

#include "FreeRTOS.h"
#include "task.h"

struct gm_semaphore {
    UBaseType_t count;
    UBaseType_t max;
    bool mutex;
    bool recursive;
    TaskHandle_t owner;
    UBaseType_t depth;
};
typedef gm_semaphore *SemaphoreHandle_t;
typedef SemaphoreHandle_t xSemaphoreHandle;

// Outside any task (ISR/timer/host context) a free mutex is taken on behalf of this sentinel.
#define GM_NO_TASK_OWNER ((TaskHandle_t)(uintptr_t)1)

static inline TaskHandle_t gm_sem_self(void) {
    TaskHandle_t t = gm_task_current();
    return t ? t : GM_NO_TASK_OWNER;
}

static inline SemaphoreHandle_t xSemaphoreCreateMutex(void) { return new gm_semaphore{1, 1, true, false, nullptr, 0}; }
static inline SemaphoreHandle_t xSemaphoreCreateRecursiveMutex(void) { return new gm_semaphore{1, 1, true, true, nullptr, 0}; }
static inline SemaphoreHandle_t xSemaphoreCreateBinary(void) { return new gm_semaphore{0, 1, false, false, nullptr, 0}; }
static inline SemaphoreHandle_t xSemaphoreCreateCounting(UBaseType_t max, UBaseType_t initial) {
    return new gm_semaphore{initial, max, false, false, nullptr, 0};
}
static inline void vSemaphoreDelete(SemaphoreHandle_t s) { delete s; }

static inline BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t ticksToWait) {
    const uint64_t deadline = gm_deadline_for(ticksToWait);
    const TaskHandle_t self = gm_sem_self();
    if (s->recursive && s->owner == self && s->count == 0) {
        s->depth++;
        return pdTRUE;
    }
    while (s->count == 0) {
        if (gm_now_us() >= deadline || !gm_wait(s, deadline))
            return pdFALSE;
    }
    s->count--;
    if (s->mutex) {
        s->owner = self;
        s->depth = 1;
    }
    return pdTRUE;
}

static inline BaseType_t xSemaphoreGive(SemaphoreHandle_t s) {
    if (s->mutex) {
        if (s->recursive && s->depth > 1) {
            s->depth--;
            return pdTRUE;
        }
        s->owner = nullptr;
        s->depth = 0;
    }
    if (s->count >= s->max)
        return pdFALSE;
    s->count++;
    gm_wake(s);
    return pdTRUE;
}

static inline BaseType_t xSemaphoreTakeRecursive(SemaphoreHandle_t s, TickType_t ticksToWait) { return xSemaphoreTake(s, ticksToWait); }
static inline BaseType_t xSemaphoreGiveRecursive(SemaphoreHandle_t s) { return xSemaphoreGive(s); }
static inline BaseType_t xSemaphoreGiveFromISR(SemaphoreHandle_t s, BaseType_t *woken) {
    if (woken)
        *woken = pdFALSE;
    return xSemaphoreGive(s);
}
static inline BaseType_t xSemaphoreTakeFromISR(SemaphoreHandle_t s, BaseType_t *woken) {
    if (woken)
        *woken = pdFALSE;
    return xSemaphoreTake(s, 0);
}

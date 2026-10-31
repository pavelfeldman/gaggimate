// FreeRTOS queues on the fiber scheduler: fixed-size items, FIFO, blocking with timeouts.
#pragma once

#include "FreeRTOS.h"
#include "task.h"
#include <cstring>
#include <deque>
#include <vector>

struct gm_queue {
    size_t itemSize;
    size_t capacity;
    std::deque<std::vector<uint8_t>> items;
};
typedef gm_queue *QueueHandle_t;
typedef QueueHandle_t xQueueHandle;

static inline QueueHandle_t xQueueCreate(UBaseType_t length, UBaseType_t itemSize) {
    return new gm_queue{itemSize, length, {}};
}

static inline void vQueueDelete(QueueHandle_t q) { delete q; }

static inline BaseType_t xQueueSend(QueueHandle_t q, const void *item, TickType_t ticksToWait) {
    const uint64_t deadline = gm_deadline_for(ticksToWait);
    while (q->items.size() >= q->capacity) {
        if (gm_now_us() >= deadline || !gm_wait(&q->capacity, deadline))
            return errQUEUE_FULL;
    }
    const auto *p = static_cast<const uint8_t *>(item);
    q->items.emplace_back(p, p + q->itemSize);
    gm_wake(&q->items);
    return pdTRUE;
}
#define xQueueSendToBack xQueueSend

static inline BaseType_t xQueueSendFromISR(QueueHandle_t q, const void *item, BaseType_t *woken) {
    if (woken)
        *woken = pdFALSE;
    return xQueueSend(q, item, 0);
}

static inline BaseType_t xQueueReceive(QueueHandle_t q, void *buffer, TickType_t ticksToWait) {
    const uint64_t deadline = gm_deadline_for(ticksToWait);
    while (q->items.empty()) {
        if (gm_now_us() >= deadline || !gm_wait(&q->items, deadline))
            return errQUEUE_EMPTY;
    }
    std::memcpy(buffer, q->items.front().data(), q->itemSize);
    q->items.pop_front();
    gm_wake(&q->capacity);
    return pdTRUE;
}

static inline UBaseType_t uxQueueSpacesAvailable(QueueHandle_t q) { return (UBaseType_t)(q->capacity - q->items.size()); }
static inline UBaseType_t uxQueueMessagesWaiting(QueueHandle_t q) { return (UBaseType_t)q->items.size(); }

static inline BaseType_t xQueueReset(QueueHandle_t q) {
    q->items.clear();
    gm_wake(&q->capacity);
    return pdPASS;
}

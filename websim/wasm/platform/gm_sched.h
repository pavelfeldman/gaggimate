// Cooperative FreeRTOS stand-in on Emscripten fibers, driven by a virtual clock.
//
// Every FreeRTOS task is a fiber with its own C stack. Blocking calls (vTaskDelay,
// xTaskDelayUntil, queue/semaphore/notify waits, delay()) park the fiber and swap back to the
// scheduler, which runs whatever is due next in virtual time. The host advances time with
// gm_advance(); nothing here reads the wall clock.
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*gm_task_fn)(void *);
typedef struct gm_task gm_task;

uint64_t gm_now_us(void);

// Tasks
gm_task *gm_task_create(gm_task_fn fn, void *arg, const char *name, uint32_t prio);
gm_task *gm_task_current(void); // nullptr in scheduler/ISR/timer context
void gm_task_delete(gm_task *task);
const char *gm_task_name(gm_task *task);
int gm_task_alive(gm_task *task);

// Park the current task until the given absolute virtual time (no-op outside a task).
void gm_sleep_until(uint64_t wake_us);

// Wait on an object: returns 1 if woken by gm_wake(obj), 0 on timeout. deadline UINT64_MAX = forever.
int gm_wait(void *obj, uint64_t deadline_us);
// Make every task waiting on obj runnable now.
void gm_wake(void *obj);

// Task notifications (ulTaskNotifyTake / xTaskNotifyGive semantics)
uint32_t gm_notify_take(int clear_on_exit, uint64_t deadline_us);
void gm_notify_give(gm_task *task);

// One-shot / periodic timers dispatched from the scheduler (esp_timer, ESP_TIMER_TASK)
typedef struct gm_timer gm_timer;
gm_timer *gm_timer_create(void (*cb)(void *), void *arg, const char *name);
void gm_timer_start(gm_timer *t, uint64_t delay_us, uint64_t period_us);
void gm_timer_stop(gm_timer *t);
void gm_timer_delete(gm_timer *t);
int gm_timer_active(gm_timer *t);

// Host entry points (exported)
void gm_advance(double target_us);
double gm_time_us(void);

#ifdef __cplusplus
}
#endif

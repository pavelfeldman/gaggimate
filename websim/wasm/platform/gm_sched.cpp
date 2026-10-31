#include "gm_sched.h"

#include <emscripten.h>
#include <emscripten/fiber.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

constexpr size_t C_STACK_SIZE = 256 * 1024;
constexpr size_t ASYNCIFY_STACK_SIZE = 128 * 1024;
constexpr uint64_t FOREVER = UINT64_MAX;
// A zero-length yield (delay(0), yield(), taskYIELD) still costs CPU time on the device; without
// a cost, polling loops like `while (millis() < t) delay(0);` would never let virtual time move.
constexpr uint64_t YIELD_COST_US = 10;

enum class State { Ready, Sleeping, Waiting, Done };

} // namespace

struct gm_task {
    emscripten_fiber_t fiber;
    void *cStack = nullptr;
    void *asyncifyStack = nullptr;
    gm_task_fn fn = nullptr;
    void *arg = nullptr;
    const char *name = "";
    uint32_t prio = 0;
    uint64_t seq = 0;
    State state = State::Ready;
    uint64_t wakeUs = 0;      // Sleeping/Ready: when to run; Waiting: deadline
    void *waitObj = nullptr;  // Waiting: what we wait on
    bool wokenByObj = false;  // result of the last gm_wait
    uint32_t notifyValue = 0; // task notification count
    bool waitingNotify = false;
};

struct gm_timer {
    void (*cb)(void *) = nullptr;
    void *arg = nullptr;
    const char *name = "";
    bool armed = false;
    bool deleted = false;
    uint64_t dueUs = 0;
    uint64_t periodUs = 0;
    uint64_t seq = 0;
};

namespace {

emscripten_fiber_t g_schedFiber;
char g_schedAsyncifyStack[ASYNCIFY_STACK_SIZE];
bool g_schedInitialized = false;

std::vector<gm_task *> g_tasks;
std::vector<gm_timer *> g_timers;
gm_task *g_current = nullptr;
uint64_t g_nowUs = 0;
uint64_t g_seq = 0;

void ensureScheduler() {
    if (g_schedInitialized)
        return;
    emscripten_fiber_init_from_current_context(&g_schedFiber, g_schedAsyncifyStack, sizeof g_schedAsyncifyStack);
    g_schedInitialized = true;
}

void taskEntry(void *arg) {
    auto *task = static_cast<gm_task *>(arg);
    task->fn(task->arg);
    // A FreeRTOS task must not return; treat it like vTaskDelete(NULL).
    task->state = State::Done;
    emscripten_fiber_swap(&task->fiber, &g_schedFiber);
}

// Swap the current task out to the scheduler. Returns when the scheduler resumes it.
void parkCurrent() {
    gm_task *task = g_current;
    emscripten_fiber_swap(&task->fiber, &g_schedFiber);
}

// When a task becomes runnable: Ready at wakeUs; Waiting tasks are due at their deadline.
uint64_t dueTime(const gm_task *t) {
    switch (t->state) {
    case State::Ready:
    case State::Sleeping:
        return t->wakeUs;
    case State::Waiting:
        return t->wakeUs; // deadline (FOREVER if none)
    default:
        return FOREVER;
    }
}

void resume(gm_task *task) {
    if (task->state == State::Waiting) {
        // Deadline reached without a wake.
        task->wokenByObj = false;
        task->waitObj = nullptr;
    }
    task->state = State::Ready;
    g_current = task;
    emscripten_fiber_swap(&g_schedFiber, &task->fiber);
    g_current = nullptr;
}

} // namespace

extern "C" {

uint64_t gm_now_us(void) { return g_nowUs; }

gm_task *gm_task_create(gm_task_fn fn, void *arg, const char *name, uint32_t prio) {
    ensureScheduler();
    auto *task = new gm_task();
    task->fn = fn;
    task->arg = arg;
    task->name = name ? name : "";
    task->prio = prio;
    task->seq = g_seq++;
    task->state = State::Ready;
    task->wakeUs = g_nowUs;
    task->cStack = malloc(C_STACK_SIZE);
    task->asyncifyStack = malloc(ASYNCIFY_STACK_SIZE);
    emscripten_fiber_init(&task->fiber, taskEntry, task, task->cStack, C_STACK_SIZE, task->asyncifyStack, ASYNCIFY_STACK_SIZE);
    g_tasks.push_back(task);
    return task;
}

gm_task *gm_task_current(void) { return g_current; }

void gm_task_delete(gm_task *task) {
    if (task == nullptr)
        task = g_current;
    if (task == nullptr)
        return;
    task->state = State::Done;
    if (task == g_current)
        parkCurrent(); // never resumed
}

const char *gm_task_name(gm_task *task) { return task ? task->name : "scheduler"; }

int gm_task_alive(gm_task *task) { return task != nullptr && task->state != State::Done; }

void gm_sleep_until(uint64_t wake_us) {
    gm_task *task = g_current;
    if (task == nullptr) {
        // Blocking outside a task (ISR, timer, host call) cannot park; the firmware never does this on purpose.
        fprintf(stderr, "[W][gm_sched] blocking call outside a task ignored\n");
        return;
    }
    task->state = State::Sleeping;
    task->wakeUs = std::max(wake_us, g_nowUs + YIELD_COST_US);
    task->seq = g_seq++;
    parkCurrent();
}

int gm_wait(void *obj, uint64_t deadline_us) {
    gm_task *task = g_current;
    if (task == nullptr)
        return 0;
    task->state = State::Waiting;
    task->waitObj = obj;
    task->wokenByObj = false;
    task->wakeUs = deadline_us;
    task->seq = g_seq++;
    parkCurrent();
    return task->wokenByObj ? 1 : 0;
}

void gm_wake(void *obj) {
    for (gm_task *t : g_tasks) {
        if (t->state == State::Waiting && t->waitObj == obj) {
            t->state = State::Ready;
            t->waitObj = nullptr;
            t->wokenByObj = true;
            t->wakeUs = g_nowUs;
            t->seq = g_seq++;
        }
    }
}

uint32_t gm_notify_take(int clear_on_exit, uint64_t deadline_us) {
    gm_task *task = g_current;
    if (task == nullptr)
        return 0;
    if (task->notifyValue == 0 && deadline_us > g_nowUs) {
        task->waitingNotify = true;
        gm_wait(&task->notifyValue, deadline_us);
        task->waitingNotify = false;
    }
    uint32_t value = task->notifyValue;
    if (value > 0)
        task->notifyValue = clear_on_exit ? 0 : value - 1;
    return value;
}

void gm_notify_give(gm_task *task) {
    if (task == nullptr)
        return;
    task->notifyValue++;
    if (task->waitingNotify)
        gm_wake(&task->notifyValue);
}

gm_timer *gm_timer_create(void (*cb)(void *), void *arg, const char *name) {
    auto *t = new gm_timer();
    t->cb = cb;
    t->arg = arg;
    t->name = name ? name : "";
    g_timers.push_back(t);
    return t;
}

void gm_timer_start(gm_timer *t, uint64_t delay_us, uint64_t period_us) {
    t->armed = true;
    t->dueUs = g_nowUs + delay_us;
    t->periodUs = period_us;
    t->seq = g_seq++;
}

void gm_timer_stop(gm_timer *t) { t->armed = false; }

void gm_timer_delete(gm_timer *t) {
    t->armed = false;
    t->deleted = true;
}

int gm_timer_active(gm_timer *t) { return t->armed ? 1 : 0; }

// Runs every task and timer due at or before target_us, in virtual-time order.
// Ties: timers before tasks (the esp_timer task outranks firmware tasks), then higher
// priority, then FIFO.
EMSCRIPTEN_KEEPALIVE void gm_advance(double target_us_d) {
    ensureScheduler();
    const uint64_t target = static_cast<uint64_t>(target_us_d);
    uint64_t lastTime = g_nowUs;
    int sameTime = 0;
    for (;;) {
        gm_timer *nextTimer = nullptr;
        for (gm_timer *t : g_timers) {
            if (!t->armed || t->dueUs > target)
                continue;
            if (!nextTimer || t->dueUs < nextTimer->dueUs || (t->dueUs == nextTimer->dueUs && t->seq < nextTimer->seq))
                nextTimer = t;
        }
        gm_task *nextTask = nullptr;
        for (gm_task *t : g_tasks) {
            const uint64_t due = dueTime(t);
            if (due > target)
                continue;
            if (!nextTask)
                nextTask = t;
            else {
                const uint64_t best = dueTime(nextTask);
                if (due < best || (due == best && (t->prio > nextTask->prio || (t->prio == nextTask->prio && t->seq < nextTask->seq))))
                    nextTask = t;
            }
        }
        if (!nextTimer && !nextTask)
            break;
        if (nextTimer && (!nextTask || nextTimer->dueUs <= dueTime(nextTask))) {
            g_nowUs = std::max(g_nowUs, nextTimer->dueUs);
            if (nextTimer->periodUs) {
                nextTimer->dueUs += nextTimer->periodUs;
                nextTimer->seq = g_seq++;
            } else {
                nextTimer->armed = false;
            }
            nextTimer->cb(nextTimer->arg);
        } else {
            g_nowUs = std::max(g_nowUs, dueTime(nextTask));
            resume(nextTask);
            // Ready-at-now wakeups (gm_wake) don't advance time; a ping-pong between tasks that never
            // sleeps would spin here forever.
            if (g_nowUs == lastTime && ++sameTime > 100000) {
                fprintf(stderr, "[E][gm_sched] runaway at %llu us in task %s\n", (unsigned long long)g_nowUs, nextTask->name);
                break;
            }
        }
        if (g_nowUs != lastTime) {
            lastTime = g_nowUs;
            sameTime = 0;
        }
    }
    if (target > g_nowUs)
        g_nowUs = target;
}

EMSCRIPTEN_KEEPALIVE double gm_time_us(void) { return static_cast<double>(g_nowUs); }

} // extern "C"

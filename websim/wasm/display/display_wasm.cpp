// Display-board glue for the web simulator: Arduino globals the desktop sim's arduino_shim.cpp
// normally defines, the embedded web UI blob symbol, the BLE scale bridge and a read-only
// inspection window for the parameters panel.
//
// The scale bridge stands in for BLEScalePlugin (device-only, excluded as in display-sim): it makes
// the same Controller::onVolumetricMeasurement(..., BLUETOOTH) call the plugin makes for each
// reading, and tares the simulated scale on the same events the plugin listens to.
#define private public
#include <display/core/Controller.h>
#undef private
#include <display/core/process/BrewProcess.h>
#include <display/main.h>

#include "gm_hal.h"
#include <ESPmDNS.h>
#include <WiFi.h>
#include <emscripten.h>

MDNSResponder MDNS;
WiFiClass WiFi;

// No network stack on the simulated board: the web server listens on in-memory connections
// (WebTransport.cpp) and never opens a socket. This keeps Emscripten's socket emulation, which
// would need a WebSocket proxy, out of the build.
extern "C" int socket(int, int, int) {
    errno = ENETDOWN;
    return -1;
}

// WebUIPlugin serves from this blob (web_ui_blob.S on device); the simulator ships the empty stub manifest.
extern const uint8_t gWebUiBlobStart[1] = {0};

namespace {

bool g_scaleAttached = false;
double g_values[64];

#define DISPLAY_FIELDS(X)                                                                                                        \
    X(mode)                                                                                                                      \
    X(systemState)                                                                                                               \
    X(error)                                                                                                                     \
    X(connected)                                                                                                                 \
    X(currentTemp)                                                                                                               \
    X(targetTemp)                                                                                                                \
    X(pressure)                                                                                                                  \
    X(targetPressure)                                                                                                            \
    X(pumpFlow)                                                                                                                  \
    X(targetFlow)                                                                                                                \
    X(puckFlow)                                                                                                                  \
    X(puckResistance)                                                                                                            \
    X(pumpPower)                                                                                                                 \
    X(heaterPower)                                                                                                               \
    X(waterPumped)                                                                                                               \
    X(coffeeVolume)                                                                                                              \
    X(scaleSource)                                                                                                               \
    X(processActive)                                                                                                             \
    X(processType)                                                                                                               \
    X(brewPhaseIndex)                                                                                                            \
    X(brewPhaseCount)                                                                                                            \
    X(brewElapsedMs)                                                                                                             \
    X(brewPhaseElapsedMs)                                                                                                        \
    X(brewVolume)                                                                                                                \
    X(brewTargetVolume)                                                                                                          \
    X(brewTarget)                                                                                                                \
    X(brewDelay)                                                                                                                 \
    X(brewLastExitReason)                                                                                                        \
    X(brewFinished)

enum Field {
#define X(name) F_##name,
    DISPLAY_FIELDS(X)
#undef X
        F_COUNT
};

const char *const NAMES_JSON = "["
#define X(name) "\"" #name "\","
    DISPLAY_FIELDS(X)
#undef X
                               "\"_\"]";

std::string g_phaseName;
std::string g_profileLabel;

} // namespace

extern "C" {

// Host, before gm_boot: present Wi-Fi as configured, like sim/main.cpp, so the display boots into
// station mode instead of the captive-portal AP.
EMSCRIPTEN_KEEPALIVE void gm_display_prepare(void) {
    Settings &settings = controller.getSettings();
    if (settings.getWifiSsid().isEmpty())
        settings.setWifiSsid("GaggiMate-Sim");
    if (settings.getWifiPassword().isEmpty())
        settings.setWifiPassword("simulator");
}

// Host: one reading from the simulated BLE scale (grams).
EMSCRIPTEN_KEEPALIVE void gm_scale_measurement(double grams) {
    if (controller.pluginManager == nullptr)
        return;
    if (!g_scaleAttached) {
        g_scaleAttached = true;
        // BLEScalePlugin::onProcessStart() double-tares on these events.
        controller.pluginManager->on("controller:brew:prestart", [](Event const &) { gm_hal_event("scale:tare", 0); });
        controller.pluginManager->on("controller:grind:start", [](Event const &) { gm_hal_event("scale:tare", 0); });
    }
    controller.onVolumetricMeasurement(grams, VolumetricMeasurementSource::BLUETOOTH);
}

EMSCRIPTEN_KEEPALIVE const char *gm_inspect_display_names(void) { return NAMES_JSON; }

EMSCRIPTEN_KEEPALIVE double *gm_inspect_display(void) {
    for (double &v : g_values)
        v = __builtin_nan("");
    Controller &c = controller;
    g_values[F_mode] = c.getMode();
    g_values[F_systemState] = c.getSystemState();
    g_values[F_error] = c.getError();
    g_values[F_connected] = c.comms.isConnected() ? 1 : 0;
    g_values[F_currentTemp] = c.getCurrentTemp();
    g_values[F_targetTemp] = c.getTargetTemp();
    g_values[F_pressure] = c.getCurrentPressure();
    g_values[F_targetPressure] = c.getTargetPressure();
    g_values[F_pumpFlow] = c.getCurrentPumpFlow();
    g_values[F_targetFlow] = c.getTargetFlow();
    g_values[F_puckFlow] = c.getCurrentPuckFlow();
    g_values[F_puckResistance] = c.getCurrentPuckResistance();
    g_values[F_pumpPower] = c.getCurrentPumpPower();
    g_values[F_heaterPower] = c.getCurrentHeaterPower();
    g_values[F_waterPumped] = c.getCurrentWaterPumped();
    g_values[F_coffeeVolume] = c.getCurrentCoffeeVolume();
    g_values[F_scaleSource] = static_cast<double>(c.getEffectiveScaleSource());
    std::lock_guard<std::recursive_mutex> guard(c.getProcessLock());
    Process *p = c.getProcess() ? c.getProcess() : c.getLastProcess();
    g_values[F_processActive] = c.getProcess() != nullptr && c.getProcess()->isActive() ? 1 : 0;
    if (p != nullptr) {
        g_values[F_processType] = p->getType();
        if (p->getType() == MODE_BREW) {
            auto *b = static_cast<BrewProcess *>(p);
            const unsigned long end = b->processPhase == ProcessPhase::FINISHED ? b->finished : millis();
            g_values[F_brewPhaseIndex] = b->phaseIndex;
            g_values[F_brewPhaseCount] = static_cast<double>(b->profile.phases.size());
            g_values[F_brewElapsedMs] = static_cast<double>(end - b->processStarted);
            g_values[F_brewPhaseElapsedMs] = static_cast<double>(end - b->currentPhaseStarted);
            g_values[F_brewVolume] = b->currentVolume;
            g_values[F_brewTargetVolume] = b->getBrewVolume();
            g_values[F_brewTarget] = b->target == ProcessTarget::VOLUMETRIC ? 1 : 0;
            g_values[F_brewDelay] = b->brewDelay;
            g_values[F_brewLastExitReason] = static_cast<double>(b->lastExitReason);
            g_values[F_brewFinished] = b->processPhase == ProcessPhase::FINISHED ? 1 : 0;
            g_phaseName = b->currentPhase.name.c_str();
            g_profileLabel = b->profile.label.c_str();
        }
    }
    return g_values;
}

EMSCRIPTEN_KEEPALIVE const char *gm_inspect_display_phase(void) { return g_phaseName.c_str(); }
EMSCRIPTEN_KEEPALIVE const char *gm_inspect_display_profile(void) {
    if (g_profileLabel.empty() && controller.getProfileManager() != nullptr)
        return controller.getProfileManager()->getSelectedProfile().label.c_str();
    return g_profileLabel.c_str();
}

} // extern "C"

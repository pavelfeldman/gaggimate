// Read-only window into controller internals for the simulator's parameter panel.
// Opens private members of the firmware classes in this translation unit only (no firmware edits);
// the object layout is unchanged because clang lays out fields in declaration order regardless of access.
#define private public
#define protected public
#include <GaggiMateController.h>
#include <peripherals/DimmedPump.h>
#undef private
#undef protected

#include <emscripten.h>

extern GaggiMateController controller;

namespace {

double g_values[64];

#define INSPECT_FIELDS(X)                                                                                                        \
    X(errorState)                                                                                                                \
    X(lastPingTime)                                                                                                              \
    X(heaterTemperature)                                                                                                         \
    X(heaterSetpoint)                                                                                                            \
    X(heaterOutput)                                                                                                              \
    X(heaterAutotuning)                                                                                                          \
    X(pidKp)                                                                                                                     \
    X(pidKi)                                                                                                                     \
    X(pidKd)                                                                                                                     \
    X(pidKff)                                                                                                                    \
    X(pidIntegral)                                                                                                               \
    X(pidPrevError)                                                                                                              \
    X(pidDistFF)                                                                                                                 \
    X(pumpMode)                                                                                                                  \
    X(pumpPower)                                                                                                                 \
    X(pumpCtrlPressure)                                                                                                          \
    X(pumpCtrlFlow)                                                                                                              \
    X(pumpCurrentPressure)                                                                                                       \
    X(pumpCurrentFlow)                                                                                                           \
    X(pumpPumpedWater)                                                                                                           \
    X(pumpValveStatus)                                                                                                           \
    X(pumpCps)                                                                                                                   \
    X(pcFilteredPressure)                                                                                                        \
    X(pcFilteredSetpoint)                                                                                                        \
    X(pcPressureDerivative)                                                                                                      \
    X(pcErrorIntegral)                                                                                                           \
    X(pcDutyCycle)                                                                                                               \
    X(pcPumpFlowRate)                                                                                                            \
    X(pcWaterThroughPuck)                                                                                                        \
    X(pcCoffeeFlowRate)                                                                                                          \
    X(pcCoffeeOutput)                                                                                                            \
    X(pcPuckConductance)                                                                                                         \
    X(pcPuckConductanceDerivative)                                                                                               \
    X(pcPuckResistance)                                                                                                          \
    X(pcPuckState0)                                                                                                              \
    X(pcPuckState1)                                                                                                              \
    X(pcPuckState2)                                                                                                              \
    X(pcFlowCoeffC)                                                                                                              \
    X(pcFlowCoeffD)                                                                                                              \
    X(sensorPressure)                                                                                                            \
    X(sensorRawPressure)                                                                                                         \
    X(sensorAveragedPressure)                                                                                                    \
    X(valveOpen)                                                                                                                 \
    X(altOpen)

enum Field {
#define X(name) F_##name,
    INSPECT_FIELDS(X)
#undef X
        F_COUNT
};

const char *const NAMES_JSON = "["
#define X(name) "\"" #name "\","
    INSPECT_FIELDS(X)
#undef X
                               "\"_\"]";

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char *gm_inspect_controller_names(void) { return NAMES_JSON; }

// Fills and returns a double[F_COUNT] snapshot (NaN where a peripheral is absent).
EMSCRIPTEN_KEEPALIVE double *gm_inspect_controller(void) {
    for (double &v : g_values)
        v = __builtin_nan("");
    GaggiMateController &c = controller;
    g_values[F_errorState] = static_cast<double>(c.errorState);
    g_values[F_lastPingTime] = static_cast<double>(c.lastPingTime);
    if (Heater *h = c.heater) {
        g_values[F_heaterTemperature] = h->temperature;
        g_values[F_heaterSetpoint] = h->setpoint;
        g_values[F_heaterOutput] = h->output;
        g_values[F_heaterAutotuning] = h->autotuning ? 1 : 0;
        g_values[F_pidKp] = h->simplePid->gainKp;
        g_values[F_pidKi] = h->simplePid->gainKi;
        g_values[F_pidKd] = h->simplePid->gainKd;
        g_values[F_pidKff] = h->combinedKff;
        g_values[F_pidIntegral] = h->simplePid->feedback_integralState;
        g_values[F_pidPrevError] = h->simplePid->prevError;
        g_values[F_pidDistFF] = h->simplePid->currentDisturbance * h->simplePid->gainDistFF;
    }
    if (c._config.capabilites.dimming && c.pump) {
        auto *p = static_cast<DimmedPump *>(c.pump);
        g_values[F_pumpMode] = static_cast<double>(p->_mode);
        g_values[F_pumpPower] = p->_power;
        g_values[F_pumpCtrlPressure] = p->_ctrlPressure;
        g_values[F_pumpCtrlFlow] = p->_ctrlFlow;
        g_values[F_pumpCurrentPressure] = p->_currentPressure;
        g_values[F_pumpCurrentFlow] = p->_currentFlow;
        g_values[F_pumpPumpedWater] = p->_pumpedWater;
        g_values[F_pumpValveStatus] = p->_valveStatus;
        g_values[F_pumpCps] = p->_cps;
        const PressureController &pc = p->_pressureController;
        g_values[F_pcFilteredPressure] = pc._filteredPressureSensor;
        g_values[F_pcFilteredSetpoint] = pc._filteredSetpoint;
        g_values[F_pcPressureDerivative] = pc._filteredPressureDerivative;
        g_values[F_pcErrorIntegral] = pc._errorIntegral;
        g_values[F_pcDutyCycle] = pc._pumpDutyCycle;
        g_values[F_pcPumpFlowRate] = pc._pumpFlowRate;
        g_values[F_pcWaterThroughPuck] = pc._waterThroughPuckFlowRate;
        g_values[F_pcCoffeeFlowRate] = pc._coffeeFlowRate;
        g_values[F_pcCoffeeOutput] = pc._coffeeOutput;
        g_values[F_pcPuckConductance] = pc._puckConductance;
        g_values[F_pcPuckConductanceDerivative] = pc._puckConductanceDerivative;
        g_values[F_pcPuckResistance] = pc._puckResistance;
        g_values[F_pcPuckState0] = pc._puckState[0];
        g_values[F_pcPuckState1] = pc._puckState[1];
        g_values[F_pcPuckState2] = pc._puckState[2];
        g_values[F_pcFlowCoeffC] = pc._pumpFlowCoefficients[2];
        g_values[F_pcFlowCoeffD] = pc._pumpFlowCoefficients[3];
    }
    if (PressureSensor *s = c.pressureSensor) {
        g_values[F_sensorPressure] = s->_pressure;
        g_values[F_sensorRawPressure] = s->_raw_pressure;
        g_values[F_sensorAveragedPressure] = s->_averagedPressure;
    }
    if (c.valve)
        g_values[F_valveOpen] = c.valve->getState() ? 1 : 0;
    if (c.alt)
        g_values[F_altOpen] = c.alt->getState() ? 1 : 0;
    return g_values;
}

} // extern "C"

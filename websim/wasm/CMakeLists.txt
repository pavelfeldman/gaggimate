# Builds the GaggiMate firmware for the web simulator with Emscripten (see ../MIGRATION.md).
# Configure through ./build.sh, which also generates gaggimate.pb.{c,h} and version.h.
cmake_minimum_required(VERSION 3.20)
project(gaggimate_websim C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_EXTENSIONS ON)

get_filename_component(REPO ${CMAKE_CURRENT_SOURCE_DIR}/../.. ABSOLUTE)
set(WASM ${CMAKE_CURRENT_SOURCE_DIR})
set(TP ${WASM}/third_party)
set(GEN ${CMAKE_BINARY_DIR}/generated)
if(NOT DEFINED OUT)
  set(OUT ${CMAKE_CURRENT_SOURCE_DIR}/../dist/wasm)
endif()

# --- shared pieces -----------------------------------------------------------------------------

set(PLATFORM_SOURCES
    ${WASM}/platform/gm_sched.cpp
    ${WASM}/platform/arduino_wasm.cpp
    ${WASM}/platform/arduino_main.cpp
    ${WASM}/platform/peripherals_wasm.cpp
    ${WASM}/platform/WasmBleTransport.cpp
    ${REPO}/sim/platform/arduino/WString.cpp
    ${REPO}/sim/platform/arduino/Print.cpp
    ${REPO}/sim/platform/arduino/Stream.cpp
    ${REPO}/sim/platform/arduino/stdlib_noniso.c
    ${REPO}/sim/platform/noniso_extra.c)

set(NANOPB_SOURCES ${TP}/nanopb/pb_common.c ${TP}/nanopb/pb_encode.c ${TP}/nanopb/pb_decode.c ${GEN}/gaggimate.pb.c)

# wasm/platform shadows sim/platform (FreeRTOS, Arduino.h, esp_log, esp_timer, drivers).
set(PLATFORM_INCLUDES
    ${WASM}/platform
    ${REPO}/sim/platform
    ${REPO}/sim/platform/arduino
    ${GEN}
    ${TP}/nanopb
    ${TP}/ArduinoJson/src
    ${REPO}/lib/NanoPbComm/src)

set(COMMON_DEFINES GAGGIMATE_WASM ARDUINO=10812 PB_ENABLE_MALLOC=0)
# The ESP32 Arduino toolchain builds without RTTI; the firmware relies on it (undefined base-class virtuals).
set(COMMON_COMPILE_OPTIONS -O2 -fno-rtti -Wno-deprecated-declarations -Wno-unused-command-line-argument)
set(COMMON_LINK_OPTIONS
    -O2
    -sASYNCIFY
    # Keeps C++ function names in the wasm so firmware crashes show readable stacks in DevTools.
    --profiling-funcs
    -sASYNCIFY_STACK_SIZE=131072
    -sSTACK_SIZE=1048576
    -sALLOW_MEMORY_GROWTH=1
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sENVIRONMENT=web,node
    -sEXIT_RUNTIME=0
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPF64,UTF8ToString,FS
    --js-library ${WASM}/platform/gm_hal.js)
set(COMMON_EXPORTS _gm_boot,_gm_advance,_gm_time_us,_gm_interrupt,_gm_link_receive,_gm_link_state,_malloc,_free)

# --- controller.wasm ---------------------------------------------------------------------------

file(GLOB_RECURSE CONTROLLER_LIB_SOURCES
    ${REPO}/lib/GaggiMateController/src/*.cpp
    ${REPO}/lib/NayrodPID/src/*.cpp
    ${REPO}/lib/overrides/src/*.cpp)

# main.cpp goes last: ESP-IDF runs global constructors in reverse link order (do_global_ctors walks
# __init_array backwards) and wasm-ld runs them forward, so this keeps the device's order -- the
# library's dynamically initialized globals (GM_* board configs) exist before `controller` is built.
add_executable(controller
    ${CONTROLLER_LIB_SOURCES}
    ${REPO}/lib/NanoPbComm/src/Endpoint.cpp
    ${REPO}/lib/NanoPbComm/src/GaggiMateServer.cpp
    ${TP}/PSM/src/PSM.cpp
    ${WASM}/controller_inspect.cpp
    ${NANOPB_SOURCES}
    ${PLATFORM_SOURCES}
    ${REPO}/src/controller/main.cpp)
target_include_directories(controller PRIVATE
    ${PLATFORM_INCLUDES}
    ${REPO}/lib/GaggiMateController/src
    ${REPO}/lib/NayrodPID/src
    ${REPO}/lib/overrides/src
    ${REPO}/lib/overrides/src/PCA9634
    ${REPO}/lib/overrides/src/VL35L0X
    ${TP}/PSM/src
    ${REPO}/src)
target_compile_definitions(controller PRIVATE ${COMMON_DEFINES})
target_compile_options(controller PRIVATE ${COMMON_COMPILE_OPTIONS})
target_link_options(controller PRIVATE ${COMMON_LINK_OPTIONS} -sEXPORT_NAME=createController
    -sEXPORTED_FUNCTIONS=${COMMON_EXPORTS},_gm_inspect_controller,_gm_inspect_controller_names)
set_target_properties(controller PROPERTIES SUFFIX ".mjs" RUNTIME_OUTPUT_DIRECTORY ${OUT})

# --- display.wasm ------------------------------------------------------------------------------

# Same source filter as platformio.ini's display-sim env, but with the real src/display/main.cpp
# (real FreeRTOS tasks) and the real NanoPbComm client instead of sim/comms.
file(GLOB_RECURSE DISPLAY_SOURCES ${REPO}/src/display/*.cpp ${REPO}/src/display/*.c)
list(FILTER DISPLAY_SOURCES EXCLUDE REGEX "/src/display/(drivers|webassets)/")
list(FILTER DISPLAY_SOURCES EXCLUDE REGEX
    "/plugins/(MQTTPlugin|HomekitPlugin|mDNSPlugin|NetworkWatchdogPlugin|WifiStaWatchdogPlugin|BLEScalePlugin|ImprovPlugin)\\.cpp$")
list(FILTER DISPLAY_SOURCES EXCLUDE REGEX "/src/display/main\\.cpp$")
file(GLOB_RECURSE LVGL_SOURCES ${TP}/lvgl/src/*.c)

add_library(lvgl STATIC ${LVGL_SOURCES})
target_include_directories(lvgl PUBLIC ${TP}/lvgl ${REPO}/src/display PRIVATE ${WASM}/platform ${REPO}/sim/platform)
target_compile_definitions(lvgl PUBLIC LV_CONF_INCLUDE_SIMPLE LV_CONF_SUPPRESS_DEFINE_CHECK)
target_compile_options(lvgl PRIVATE -O2 -Wno-everything)

add_executable(display
    ${DISPLAY_SOURCES}
    ${REPO}/lib/NanoPbComm/src/Endpoint.cpp
    ${REPO}/lib/NanoPbComm/src/GaggiMateClient.cpp
    ${REPO}/sim/driver/driver_base.cpp
    ${REPO}/sim/platform/fs_shim.cpp
    ${REPO}/sim/platform/preferences_shim.cpp
    ${REPO}/sim/web/ESPAsyncWebServer.cpp
    ${REPO}/sim/web/blescale_stub.cpp
    ${WASM}/display/SdlDriver.cpp
    ${WASM}/display/display_wasm.cpp
    ${NANOPB_SOURCES}
    ${PLATFORM_SOURCES}
    ${REPO}/src/display/main.cpp)
target_include_directories(display PRIVATE
    ${WASM}/display
    ${PLATFORM_INCLUDES}
    ${REPO}/sim/web
    ${REPO}/src)
target_compile_definitions(display PRIVATE ${COMMON_DEFINES} GAGGIMATE_SIM DISABLE_ALL_LIBRARY_WARNINGS CORE_DEBUG_LEVEL=3)
target_compile_options(display PRIVATE ${COMMON_COMPILE_OPTIONS})
target_link_libraries(display PRIVATE lvgl)
target_link_options(display PRIVATE ${COMMON_LINK_OPTIONS} -sEXPORT_NAME=createDisplay
    -sEXPORTED_FUNCTIONS=${COMMON_EXPORTS},_gm_display_prepare,_gm_display_framebuffer,_gm_display_frames,_gm_display_brightness,_gm_touch,_gm_scale_measurement,_gm_inspect_display,_gm_inspect_display_names,_gm_inspect_display_phase,_gm_inspect_display_profile)
set_target_properties(display PROPERTIES SUFFIX ".mjs" RUNTIME_OUTPUT_DIRECTORY ${OUT})

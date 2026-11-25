#pragma once

#include "../hx711.h"

// Load cell 2: HX711 DT -> GPIO3, SCK -> GPIO8.
static LoadCell loadCell2(2, 3, 8, "loadcell2");

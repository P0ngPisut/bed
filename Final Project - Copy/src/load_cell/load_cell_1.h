#pragma once

#include "../hx711.h"

// Load cell 1: HX711 DT -> GPIO10, SCK -> GPIO9.
static LoadCell loadCell1(1, 10, 9, "loadcell");

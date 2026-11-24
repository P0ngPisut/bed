#pragma once

#include <Arduino.h>

enum class LedColor { Off, Red, Yellow, Green };

void beginLed();
void setLed(LedColor color);
void updateLed();
bool handleLedCommand(const String &command);

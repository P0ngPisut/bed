#include "led.h"

namespace {
constexpr uint8_t RED_PIN = 37;
constexpr uint8_t YELLOW_PIN = 38;
constexpr uint8_t GREEN_PIN = 39;
constexpr unsigned long LED_TIMEOUT_MS = 3000;
LedColor currentColor = LedColor::Off;
unsigned long lastCommandMs = 0;

void writeLedPins(LedColor color) {
  // Common-cathode / active-HIGH RYG module.
  digitalWrite(RED_PIN, color == LedColor::Red ? HIGH : LOW);
  digitalWrite(YELLOW_PIN, color == LedColor::Yellow ? HIGH : LOW);
  digitalWrite(GREEN_PIN, color == LedColor::Green ? HIGH : LOW);
}
}  // namespace

void beginLed() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  writeLedPins(LedColor::Off);
}

void setLed(LedColor color) {
  currentColor = color;
  lastCommandMs = millis();
  writeLedPins(color);
}

void updateLed() {
  if (currentColor != LedColor::Off && millis() - lastCommandMs > LED_TIMEOUT_MS) {
    setLed(LedColor::Off);
  }
}

bool handleLedCommand(const String &command) {
  if (!command.startsWith("led ")) return false;
  const String color = command.substring(4);
  if (color == "red") setLed(LedColor::Red);
  else if (color == "yellow") setLed(LedColor::Yellow);
  else if (color == "green") setLed(LedColor::Green);
  else if (color == "off") setLed(LedColor::Off);
  else Serial.println("Use: led red | led yellow | led green | led off");
  return true;
}

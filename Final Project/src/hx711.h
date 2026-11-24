#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <math.h>

class LoadCell {
 public:
  LoadCell(uint8_t number, uint8_t doutPin, uint8_t clockPin, const char *storageName)
      : number_(number), doutPin_(doutPin), clockPin_(clockPin), storageName_(storageName) {}

  void begin() {
    pinMode(doutPin_, INPUT);
    pinMode(clockPin_, OUTPUT);
    digitalWrite(clockPin_, LOW);
    preferences_.begin(storageName_, false);
    countsPerKg_ = preferences_.getFloat("countsPerKg", 0.0f);
    if (!average(zeroOffset_)) printError();
  }

  void tare() {
    int32_t reading;
    if (!average(reading)) {
      printError();
      return;
    }
    zeroOffset_ = reading;
    Serial.printf("Cell %u | Tare complete.\n", number_);
  }

  void calibrate(float knownKg) {
    int32_t reading;
    if (!average(reading)) {
      printError();
      return;
    }
    const float counts = (reading - zeroOffset_) / knownKg;
    if (fabsf(counts) < 1.0f) {
      Serial.printf("Cell %u | Calibration failed. Tare and check wiring.\n", number_);
      return;
    }
    countsPerKg_ = counts;
    preferences_.putFloat("countsPerKg", countsPerKg_);
    Serial.printf("Cell %u | Calibrated: %.2f counts/kg (saved)\n", number_, countsPerKg_);
  }

  void check(float knownKg) {
    if (fabsf(countsPerKg_) < 1.0f) {
      Serial.printf("Cell %u | Calibrate first.\n", number_);
      return;
    }
    int32_t reading;
    if (!average(reading)) {
      printError();
      return;
    }
    const float measuredKg = (reading - zeroOffset_) / countsPerKg_;
    const float errorPercent = fabsf(measuredKg - knownKg) / knownKg * 100.0f;
    Serial.printf("Cell %u | Check: %.0f g vs %.0f g | error: %.2f%% | %s (limit: 10%%)\n",
                  number_, measuredKg * 1000.0f, knownKg * 1000.0f,
                  errorPercent, errorPercent <= 10.0f ? "PASS" : "FAIL");
  }

  String displayWeight() {
    int32_t reading;
    if (!average(reading, 5)) {
      printError();
      return "N/A";
    }
    const int32_t net = reading - zeroOffset_;
    if (fabsf(countsPerKg_) < 1.0f) {
      return "Uncalibrated";
    }

    const long weightGrams = lroundf((net / countsPerKg_) * 1000.0f);
    const long magnitude = weightGrams < 0 ? -weightGrams : weightGrams;
    const char *sign = weightGrams < 0 ? "-" : "";
    char weightText[32];
    if (magnitude < 1000) {
      snprintf(weightText, sizeof(weightText), "%ld g", weightGrams);
    } else if (magnitude % 1000 == 0) {
      snprintf(weightText, sizeof(weightText), "%s%ld Kg", sign, magnitude / 1000);
    } else {
      snprintf(weightText, sizeof(weightText), "%s%ld Kg %ld g", sign,
               magnitude / 1000, magnitude % 1000);
    }
    return String(weightText);
  }

 private:
  enum class Error { None, NotReady, DoutStuckLow, NoConversionWait };

  bool read(int32_t &value) {
    const unsigned long start = millis();
    while (digitalRead(doutPin_) == HIGH) {
      if (millis() - start > 1000) {
        error_ = Error::NotReady;
        return false;
      }
      delay(1);
    }
    lastReadyWaitMs_ = millis() - start;

    uint32_t bits = 0;
    noInterrupts();
    for (uint8_t i = 0; i < 24; ++i) {
      digitalWrite(clockPin_, HIGH);
      delayMicroseconds(1);
      bits = (bits << 1) | digitalRead(doutPin_);
      digitalWrite(clockPin_, LOW);
      delayMicroseconds(1);
    }
    digitalWrite(clockPin_, HIGH);  // 25th clock: channel A, gain 128.
    delayMicroseconds(1);
    digitalWrite(clockPin_, LOW);
    interrupts();

    delayMicroseconds(1);
    if (digitalRead(doutPin_) == LOW) {
      error_ = Error::DoutStuckLow;
      return false;
    }
    if (bits & 0x800000UL) bits |= 0xFF000000UL;
    value = static_cast<int32_t>(bits);
    error_ = Error::None;
    return true;
  }

  bool average(int32_t &result, uint8_t samples = 10) {
    int64_t sum = 0;
    unsigned long readyWaitMs = 0;
    for (uint8_t i = 0; i < samples; ++i) {
      int32_t reading;
      if (!read(reading)) return false;
      readyWaitMs += lastReadyWaitMs_;
      sum += reading;
    }
    if (samples >= 5 && readyWaitMs < 5) {
      error_ = Error::NoConversionWait;
      return false;
    }
    result = static_cast<int32_t>(sum / samples);
    return true;
  }

  void printError() const {
    const char *reason = "unknown error";
    if (error_ == Error::NotReady) reason = "DT stayed HIGH";
    if (error_ == Error::DoutStuckLow) reason = "DT stayed LOW after 25 clocks";
    if (error_ == Error::NoConversionWait) reason = "no conversion wait";
    Serial.printf("Cell %u | HX711: %s; check DT->GPIO%u, SCK->GPIO%u, 3V3 and GND.\n",
                  number_, reason, doutPin_, clockPin_);
  }

  uint8_t number_;
  uint8_t doutPin_;
  uint8_t clockPin_;
  const char *storageName_;
  Preferences preferences_;
  int32_t zeroOffset_ = 0;
  float countsPerKg_ = 0.0f;
  Error error_ = Error::None;
  unsigned long lastReadyWaitMs_ = 0;
};

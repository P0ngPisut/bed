#include <Arduino.h>
#include <Preferences.h>
#include <math.h>

// HX711: DT -> GPIO10, SCK -> GPIO9. Change these for your wiring.
constexpr uint8_t HX_DOUT = 10;
constexpr uint8_t HX_SCK = 9;
constexpr unsigned long HX_TIMEOUT_MS = 1000;

Preferences preferences;
int32_t zeroOffset = 0;
float countsPerKg = 0.0f;
enum class HxError { None, NotReady, DoutStuckLow, NoConversionWait };
HxError lastHxError = HxError::None;
unsigned long lastReadyWaitMs = 0;
unsigned long batchReadyWaitMs = 0;

void printHxError() {
  if (lastHxError == HxError::NotReady) {
    Serial.println("HX711: DT stayed HIGH; check power and DT/SCK wiring.");
  } else if (lastHxError == HxError::DoutStuckLow) {
    Serial.println("HX711: DT stayed LOW after 25 clocks; check DT/SCK wiring or HX711 module.");
  } else if (lastHxError == HxError::NoConversionWait) {
    Serial.println("HX711: no conversion wait; check DT->GPIO10, SCK->GPIO9, 3V3, GND and HX711 module.");
  }
}

bool readHx711(int32_t &value) {
  const unsigned long start = millis();
  while (digitalRead(HX_DOUT) == HIGH) {
    if (millis() - start > HX_TIMEOUT_MS) {
      lastHxError = HxError::NotReady;
      return false;
    }
    delay(1);
  }
  lastReadyWaitMs = millis() - start;

  uint32_t bits = 0;
  noInterrupts();
  for (uint8_t i = 0; i < 24; ++i) {
    digitalWrite(HX_SCK, HIGH);
    delayMicroseconds(1);
    bits = (bits << 1) | digitalRead(HX_DOUT);
    digitalWrite(HX_SCK, LOW);
    delayMicroseconds(1);
  }
  // 25th clock selects channel A, gain 128 for the next conversion.
  digitalWrite(HX_SCK, HIGH);
  delayMicroseconds(1);
  digitalWrite(HX_SCK, LOW);
  interrupts();

  // A real HX711 raises DOUT after the 25th clock until the next conversion.
  delayMicroseconds(1);
  if (digitalRead(HX_DOUT) == LOW) {
    lastHxError = HxError::DoutStuckLow;
    return false;
  }

  if (bits & 0x800000UL) bits |= 0xFF000000UL;
  value = static_cast<int32_t>(bits);
  lastHxError = HxError::None;
  return true;
}

bool averageReading(int32_t &result, uint8_t samples = 10) {
  int64_t sum = 0;
  batchReadyWaitMs = 0;
  for (uint8_t i = 0; i < samples; ++i) {
    int32_t reading;
    if (!readHx711(reading)) return false;
    batchReadyWaitMs += lastReadyWaitMs;
    sum += reading;
  }
  // At 80 samples/s even five conversions take much longer than 5 ms.
  // Immediate repeated reads mean DOUT is not reporting real HX711 conversions.
  if (samples >= 5 && batchReadyWaitMs < 5) {
    lastHxError = HxError::NoConversionWait;
    return false;
  }
  result = static_cast<int32_t>(sum / samples);
  return true;
}

void handleCommand(String command) {
  command.trim();
  if (command.equalsIgnoreCase("tare")) {
    int32_t reading;
    if (averageReading(reading)) {
      zeroOffset = reading;
      Serial.println("Tare complete.");
    } else {
      printHxError();
    }
  } else if (command.startsWith("cal ")) {
    const float knownKg = command.substring(4).toFloat();
    if (!isfinite(knownKg) || knownKg <= 0.0f || knownKg > 20.0f) {
      Serial.println("Use: cal <known weight in kg>, e.g. cal 1.0");
      return;
    }
    int32_t reading;
    if (!averageReading(reading)) {
      printHxError();
      return;
    }
    countsPerKg = (reading - zeroOffset) / knownKg;
    if (fabsf(countsPerKg) < 1.0f) {
      Serial.println("Calibration failed. Check the load cell and tare first.");
      return;
    }
    preferences.putFloat("countsPerKg", countsPerKg);
    Serial.printf("Calibrated: %.2f counts/kg (saved)\n", countsPerKg);
  } else if (command.startsWith("check ")) {
    const float knownKg = command.substring(6).toFloat();
    if (!isfinite(knownKg) || knownKg <= 0.0f || knownKg > 20.0f) {
      Serial.println("Use: check <known weight in kg>, e.g. check 1.0");
      return;
    }
    if (fabsf(countsPerKg) < 1.0f) {
      Serial.println("Calibrate first with cal <known weight in kg>.");
      return;
    }
    int32_t reading;
    if (!averageReading(reading)) {
      printHxError();
      return;
    }
    const float measuredKg = (reading - zeroOffset) / countsPerKg;
    const float errorGrams = fabsf(measuredKg - knownKg) * 1000.0f;
    Serial.printf("Check: %.0f g vs %.0f g | error: %.2f g | %s (+/-5 g)\n",
                  measuredKg * 1000.0f, knownKg * 1000.0f, errorGrams,
                  errorGrams <= 5.0f ? "PASS" : "FAIL");
  } else if (command.length()) {
    Serial.println("Commands: tare | cal <known kg> | check <known kg>");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(HX_DOUT, INPUT);
  pinMode(HX_SCK, OUTPUT);
  digitalWrite(HX_SCK, LOW);
  preferences.begin("loadcell", false);
  countsPerKg = preferences.getFloat("countsPerKg", 0.0f);
  delay(1500);
  Serial.println("ESP32-S3 + HX711 load cell (20 kg)");
  Serial.println("Leave the cell unloaded while starting...");
  if (!averageReading(zeroOffset)) {
    printHxError();
  }
  Serial.println("Commands: tare | cal <known kg> | check <known kg>");
}

void loop() {
  if (Serial.available()) {
    handleCommand(Serial.readStringUntil('\n'));
  }

  int32_t reading;
  if (!averageReading(reading, 5)) {
    printHxError();
    delay(1000);
    return;
  }
  const int32_t net = reading - zeroOffset;
  if (fabsf(countsPerKg) >= 1.0f) {
    const float grams = (net / countsPerKg) * 1000.0f;
    const long weightGrams = lroundf(grams);
    const long bandMin = weightGrams - 5;
    const long bandMax = weightGrams + 5;
    char weightText[32];
    const long magnitude = weightGrams < 0 ? -weightGrams : weightGrams;
    const char *sign = weightGrams < 0 ? "-" : "";
    if (magnitude < 1000) {
      snprintf(weightText, sizeof(weightText), "%ld g", weightGrams);
    } else if (magnitude % 1000 == 0) {
      snprintf(weightText, sizeof(weightText), "%s%ld Kg", sign, magnitude / 1000);
    } else {
      snprintf(weightText, sizeof(weightText), "%s%ld Kg %ld g", sign,
               magnitude / 1000, magnitude % 1000);
    }
    Serial.printf("Weight: %s | band +/-5g: %ld..%ld g | raw: %ld\n",
                  weightText, bandMin, bandMax,
                  static_cast<long>(reading));
  } else {
    Serial.printf("Uncalibrated | net counts: %ld | raw: %ld\n",
                  static_cast<long>(net), static_cast<long>(reading));
  }
  delay(500);
}

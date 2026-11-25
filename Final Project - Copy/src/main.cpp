#include <Arduino.h>
#include <math.h>

#include "led.h"
#include "load_cell/load_cell_1.h"
#include "load_cell/load_cell_2.h"

void printCommands() {
  Serial.println("Commands: tare [1|2] | cal [1|2] <known kg> | check [1|2] <known kg> | led red/yellow/green/off");
  Serial.println("Without a cell number, tare/cal/check use cell 1.");
}

void handleCommand(String command) {
  command.trim();
  command.toLowerCase();
  if (handleLedCommand(command)) return;

  const int firstSpace = command.indexOf(' ');
  const String action = firstSpace < 0 ? command : command.substring(0, firstSpace);
  String args = firstSpace < 0 ? "" : command.substring(firstSpace + 1);
  args.trim();
  if (action != "tare" && action != "cal" && action != "check") {
    if (command.length()) printCommands();
    return;
  }

  uint8_t number = 1;
  if (action == "tare") {
    if (args.length()) {
      if (args != "1" && args != "2") {
        printCommands();
        return;
      }
      number = args.toInt();
    }
  } else {
    const int secondSpace = args.indexOf(' ');
    if (secondSpace >= 0) {
      const String selected = args.substring(0, secondSpace);
      if (selected != "1" && selected != "2") {
        printCommands();
        return;
      }
      number = selected.toInt();
      args = args.substring(secondSpace + 1);
      args.trim();
    }
    const float knownKg = args.toFloat();
    if (!isfinite(knownKg) || knownKg <= 0.0f || knownKg > 20.0f) {
      Serial.println("Use: cal 2 1.0 or check 2 1.0 (weight in kg, max 20).");
      return;
    }
    LoadCell &cell = number == 1 ? loadCell1 : loadCell2;
    if (action == "cal") cell.calibrate(knownKg);
    else cell.check(knownKg);
    return;
  }

  LoadCell &cell = number == 1 ? loadCell1 : loadCell2;
  cell.tare();
}

void setup() {
  Serial.begin(115200);
  beginLed();
  delay(1500);
  Serial.println("ESP32-S3 + two HX711 load cells (20 kg each)");
  Serial.println("Leave both cells unloaded while starting...");
  loadCell1.begin();
  loadCell2.begin();
  printCommands();
}

void loop() {
  updateLed();
  if (Serial.available()) handleCommand(Serial.readStringUntil('\n'));
  const String cell1Weight = loadCell1.displayWeight();
  const String cell2Weight = loadCell2.displayWeight();
  Serial.printf("Cell1: %s | Cell2: %s\n", cell1Weight.c_str(), cell2Weight.c_str());
  delay(500);
}

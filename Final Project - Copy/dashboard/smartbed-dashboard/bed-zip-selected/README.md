# Smartbed: selected files from Bed.zip

This folder contains only the Arduino Uno firmware, ESP32 firmware, and the HTML dashboard with its required JavaScript, CSS, and MQTT client assets.

- `firmware/Arduino.ino`: Arduino Uno firmware, Serial at 115200 baud.
- `firmware/ESP32.ino`: ESP32 firmware, USB Serial and UART to Uno at 115200 baud.
- `dashboard/`: MQTT/WebSocket dashboard and required front-end assets.

Before flashing, replace `CHANGE_ME` in `ESP32.ino` with your own Wi-Fi SSID/password and MQTT username/password. The dashboard needs the matching MQTT WebSocket URL and account. The existing working dashboard and firmware were left untouched.

/*
 * Arduino Uno - Smart Bed Controller for ESP32
 * Fixed Serial Communication - Compatible with ESP32 Pin 25/26
 * Version: Compatible 1.1
 *
 * ⚠️ ฮาร์ดแวร์: TX (pin 1) ของ Uno เป็น 5V -> ต่อเข้า RX ของ ESP32 ผ่าน voltage divider/level shifter
 * ⚠️ Serial pin 0/1 ใช้ร่วมกับ USB: ถอดสายไป ESP32 ก่อนอัปโหลดโค้ด
 * ⚠️ ตำแหน่งนับจากเวลา (5 วินาที/ระดับ) ไม่มี limit switch - หลังรีบูตจะถือว่าอยู่ที่ (0,5,5) เสมอ
 */

// === Pin Definitions ===
// Back Motor (หลัง)
#define BACK_PWM_F 3
#define BACK_PWM_R 5

// Side Motor (ตะแคง)
#define SIDE_PWM_F 6
#define SIDE_PWM_R 9

// Leg Motor (ขา)
#define LEG_PWM_F 10
#define LEG_PWM_R 11

// Other pins
#define EMERGENCY_PIN A0
#define LED_STATUS A1

// === System State ===
enum SystemState {
  STATE_READY,
  STATE_MOVING,
  STATE_EMERGENCY
} currentState = STATE_READY;

// === Position Variables ===
struct BedPosition {
  int backLevel = 0;        // 0-8 (0=flat, 8=raised)
  int sideLevel = 5;        // 0-10 (5=center)
  int legLevel = 5;         // -2 to 10 (5=neutral) - FLAT position
} currentPos, targetPos;

// === Control Variables ===
bool isMoving = false;
bool testRunning = false;
enum SitPhase { SIT_NONE, SIT_LEG_UP, SIT_BACK_UP, SIT_LEG_DOWN } sitPhase = SIT_NONE;
unsigned long testStartTime = 0;
const unsigned long TEST_DURATION = 25000;   // backrest motor test runs for 25 seconds
unsigned long stepTimer = 0;
unsigned long movementStepDuration = 1000;
unsigned long emergencyTimer = 0;
unsigned long statusTimer = 0;
unsigned long heartbeatTimer = 0;

enum JogMotor {
  JOG_NONE,
  JOG_BACK_UP,
  JOG_BACK_DOWN,
  JOG_SIDE_LEFT,
  JOG_SIDE_RIGHT,
  JOG_LEG_UP,
  JOG_LEG_DOWN
} activeJog = JOG_NONE;
JogMotor activeFine = JOG_NONE;
unsigned long fineStartTime = 0;

unsigned long jogCommandTimer = 0;
unsigned long jogStepTimer = 0;
long backJogProgress = 0;
long sideJogProgress = 0;
long legJogProgress = 0;

void processJogCommand(String params);
void processFineCommand(String params);
void handleFine(unsigned long now);
void stopFine();
void processSitCommand();
void handleJog(unsigned long now);
long* jogProgressFor(JogMotor motor);
int jogDirection(JogMotor motor);
bool applyJogLevelDelta(JogMotor motor, int delta);
bool updateJogProgress(JogMotor motor, unsigned long elapsed);
bool jogAtLimit(JogMotor motor);
void startJogMotor(JogMotor motor);
void stopJog(bool timedOut, bool hitLimit = false);

// === Configuration ===
const int MOTOR_SPEED = 255;        // PWM speed (0-255)
const int STEP_DELAY = 5000;        // ms per side/leg level, matching the backrest
const int BACK_STEP_DELAY = 5000;   // ms per backrest level (5 seconds)
const unsigned long LEG_RETURN_EXTRA_DELAY = 2000; // Compensate both directions on return to flat
const unsigned long JOG_COMMAND_TIMEOUT = 700; // Stop if dashboard keepalives are lost
const unsigned long FINE_DURATION = 2000; // One fine correction runs for two seconds
const int EMERGENCY_CHECK = 50;     // ms
const int STATUS_INTERVAL = 3000;   // ms
const int HEARTBEAT_INTERVAL = 1000; // Send heartbeat every 1 sec

// === Serial Communication ===
String inputBuffer = "";

void setup() {
  // ✅ ใช้ Serial ปกติ (Pin 0,1) เพื่อสื่อสารกับ ESP32
  Serial.begin(115200);
  delay(1000);
  
  // Initialize hardware
  setupMotorPins();
  pinMode(EMERGENCY_PIN, INPUT_PULLUP);
  pinMode(LED_STATUS, OUTPUT);
  
  // Initialize system
  stopAllMotors();
  currentState = STATE_READY;
  digitalWrite(LED_STATUS, HIGH);
  
  // Set initial positions (FLAT = default)
  currentPos.backLevel = 0;   // Flat
  currentPos.sideLevel = 5;   // Center
  currentPos.legLevel = 5;    // Neutral - FLAT position
  
  targetPos.backLevel = 0;
  targetPos.sideLevel = 5;
  targetPos.legLevel = 5;
  
  // Clear serial buffer
  clearSerialBuffer();
  
  // ✅ ส่งสัญญาณเริ่มต้นไปยัง ESP32
  Serial.println(F("ARDUINO_READY"));
  delay(100);
  Serial.println(F("Smart Bed Arduino Ready - Pin 0/1 Serial"));
  Serial.println(F("Default Position: FLAT (0,5,5)"));
  Serial.println(F("Waiting for ESP32 commands..."));
  
  sendStatus();
  heartbeatTimer = millis();
}

void loop() {
  unsigned long now = millis();
  
  // Check emergency button
  if (now - emergencyTimer >= EMERGENCY_CHECK) {
    checkEmergencyButton();
    emergencyTimer = now;
  }
  
  // Handle serial communication
  handleSerialInput();
  
  if (activeJog != JOG_NONE) {
    handleJog(now);
  }
  if (activeFine != JOG_NONE) {
    handleFine(now);
  }

  // Handle movement
  if (isMoving && currentState == STATE_MOVING) {
    handleMovement(now);
  }

  // Handle motor test (non-blocking)
  if (testRunning) {
    handleTest(now);
  }
  
  // Send periodic status
  if (now - statusTimer >= STATUS_INTERVAL) {
    sendStatus();
    statusTimer = now;
  }
  
  // Send heartbeat to ESP32
  if (now - heartbeatTimer >= HEARTBEAT_INTERVAL) {
    Serial.println(F("HEARTBEAT"));
    heartbeatTimer = now;
  }
  
  // Update LED
  updateStatusLED();
}

// === Serial Communication ===
void handleSerialInput() {
  while (Serial.available()) {
    char c = Serial.read();
    
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processCommand();
      }
    } else if (c >= 32 && c <= 126) {  // Printable ASCII
      inputBuffer += c;
      
      // Prevent overflow
      if (inputBuffer.length() > 50) {
        Serial.println(F("ERROR:BUFFER_OVERFLOW"));
        clearInputBuffer();
      }
    }
  }
}

void processCommand() {
  String cmd = inputBuffer;
  cmd.trim();
  cmd.toUpperCase();
  
  // ✅ ส่ง Echo กลับไปยัง ESP32 เพื่อยืนยันการรับคำสั่ง
  Serial.print(F("RECEIVED: "));
  Serial.println(cmd);
  
  clearInputBuffer();
  
  if (cmd == "STATUS") {
    sendStatus();
  }
  else if (cmd.startsWith("JOG:")) {
    processJogCommand(cmd.substring(4));
  }
  else if (cmd.startsWith("FINE:")) {
    processFineCommand(cmd.substring(5));
  }
  else if (cmd.startsWith("MOVE:")) {
    processMoveCommand(cmd.substring(5));
  }
  else if (cmd == "SIT") {
    processSitCommand();
  }
  else if (cmd.startsWith("TEST:")) {
    processTestCommand(cmd.substring(5));
  }
  else if (cmd == "STOP") {
    activateEmergencyStop();
  }
  else if (cmd == "RESET") {
    resetToFlat();
  }
  else if (cmd == "REBASE") {
    rebaseToFlat();
  }
  else if (cmd == "PING") {
    Serial.println(F("PONG"));
  }
  else if (cmd == "HELLO") {
    Serial.println(F("ARDUINO_READY"));
  }
  else if (cmd.length() > 0) {
    Serial.print(F("ERROR:UNKNOWN_COMMAND:"));
    Serial.println(cmd);
  }
}

void processMoveCommand(String params) {
  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }
  
  if (isMoving || testRunning || activeJog != JOG_NONE || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }
  
  // Parse: "5,5,7" (backLevel, sideLevel, legLevel)
  int comma1 = params.indexOf(',');
  int comma2 = params.indexOf(',', comma1 + 1);
  
  if (comma1 == -1 || comma2 == -1) {
    Serial.println(F("ERROR:INVALID_FORMAT"));
    return;
  }
  
  int newBackLevel = params.substring(0, comma1).toInt();
  int newSideLevel = params.substring(comma1 + 1, comma2).toInt();
  int newLegLevel = params.substring(comma2 + 1).toInt();
  
  // Validate ranges
  if (newBackLevel < 0 || newBackLevel > 8 || 
      newSideLevel < -10 || newSideLevel > 10 || 
      newLegLevel < -2 || newLegLevel > 10) {
    Serial.println(F("ERROR:OUT_OF_RANGE"));
    return;
  }
  
  // Set targets and start movement
  targetPos.backLevel = newBackLevel;
  targetPos.sideLevel = newSideLevel;
  targetPos.legLevel = newLegLevel;
  
  startMovement();
}

void processSitCommand() {
  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }
  if (isMoving || testRunning || activeJog != JOG_NONE || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }
  if (currentPos.backLevel != 0 || currentPos.sideLevel != 5 || currentPos.legLevel != 5) {
    Serial.println(F("ERROR:SIT_REQUIRES_FLAT"));
    return;
  }

  sitPhase = SIT_LEG_UP;
  targetPos = currentPos;
  targetPos.legLevel = 6;
  startMovement();
}

void processTestCommand(String params) {
  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }

  if (params == "ALL_STOP") {
    activeJog = JOG_NONE;
    activeFine = JOG_NONE;
    sitPhase = SIT_NONE;
    stopAllMotors();
    isMoving = false;
    if (testRunning) {
      testRunning = false;
    }
    currentState = STATE_READY;
    Serial.println(F("All motors stopped"));
    return;
  }

  if (isMoving || testRunning || activeJog != JOG_NONE || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }

  // ✅ ไม่ใช้ delay(2000) แล้ว - เดิมระหว่างทดสอบจะไม่เช็คปุ่มฉุกเฉินและไม่รับคำสั่ง STOP
  //    มอเตอร์จะถูกหยุดใน loop() เมื่อครบ TEST_DURATION
  if (params == "BACK_UP")         moveBackUp();
  else if (params == "BACK_DOWN")  moveBackDown();
  else {
    Serial.println(F("ERROR:UNKNOWN_TEST_COMMAND"));
    return;
  }

  testRunning = true;
  testStartTime = millis();
  currentState = STATE_MOVING;

  Serial.print(F("Testing motor: "));
  Serial.println(params);
  sendStatus();
}

void handleTest(unsigned long now) {
  if (now - testStartTime >= TEST_DURATION) {
    stopAllMotors();
    testRunning = false;
    currentState = STATE_READY;
    Serial.println(F("TEST_COMPLETE"));
    sendStatus();
  }
}

void startMovement() {
  isMoving = true;
  currentState = STATE_MOVING;
  movementStepDuration = currentPos.backLevel != targetPos.backLevel
    ? BACK_STEP_DELAY : STEP_DELAY;
  stepTimer = millis() - movementStepDuration; // Start the first level immediately
  
  Serial.println(F("MOVING"));
  sendStatus();
  
  Serial.print(F("Movement started to: "));
  Serial.print(targetPos.backLevel); Serial.print(F(","));
  Serial.print(targetPos.sideLevel); Serial.print(F(","));
  Serial.println(targetPos.legLevel);
}

void resetToFlat() {
  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }
  if (isMoving || testRunning || activeJog != JOG_NONE || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }
  
  // Reset to FLAT position (0,5,5)
  targetPos.backLevel = 0;    // Flat
  targetPos.sideLevel = 5;    // Center  
  targetPos.legLevel = 5;     // Neutral - FLAT position
  
  startMovement();
  Serial.println(F("Resetting to FLAT position (0,5,5)"));
}

void rebaseToFlat() {
  if (currentState != STATE_READY || isMoving || testRunning || activeJog != JOG_NONE) {
    Serial.println(F("ERROR:REBASE_REQUIRES_READY"));
    return;
  }

  // Recalibrate the software counters only; no motor command is issued.
  currentPos.backLevel = 0;
  currentPos.sideLevel = 5;
  currentPos.legLevel = 5;
  targetPos = currentPos;
  backJogProgress = 0;
  sideJogProgress = 0;
  legJogProgress = 0;
  sitPhase = SIT_NONE;
  Serial.println(F("REBASE_COMPLETE"));
  sendStatus();
}

// === Movement Control ===
void processFineCommand(String params) {
  params.trim();
  if (params == "STOP") {
    stopFine();
    return;
  }
  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }
  if (isMoving || testRunning || activeJog != JOG_NONE || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }

  JogMotor motor = JOG_NONE;
  if (params == "BACK_UP") motor = JOG_BACK_UP;
  else if (params == "BACK_DOWN") motor = JOG_BACK_DOWN;
  else if (params == "SIDE_LEFT") motor = JOG_SIDE_LEFT;
  else if (params == "SIDE_RIGHT") motor = JOG_SIDE_RIGHT;
  else if (params == "LEG_UP") motor = JOG_LEG_UP;
  else if (params == "LEG_DOWN") motor = JOG_LEG_DOWN;
  if (motor == JOG_NONE) {
    Serial.println(F("ERROR:INVALID_FINE_COMMAND"));
    return;
  }

  const bool side = motor == JOG_SIDE_LEFT || motor == JOG_SIDE_RIGHT;
  if ((side && (currentPos.backLevel != 0 || currentPos.legLevel != 5)) ||
      (!side && currentPos.sideLevel != 5)) {
    Serial.println(F("ERROR:INTERLOCK"));
    return;
  }

  // A6 trims the physical angle without changing the coarse level counter.
  activeFine = motor;
  fineStartTime = millis();
  currentState = STATE_MOVING;
  startJogMotor(motor);
  Serial.println(F("FINE_STARTED"));
  sendStatus();
}

void handleFine(unsigned long now) {
  if (activeFine != JOG_NONE && now - fineStartTime >= FINE_DURATION) stopFine();
}

void stopFine() {
  if (activeFine != JOG_NONE) {
    activeFine = JOG_NONE;
    stopAllMotors();
    if (currentState != STATE_EMERGENCY) currentState = STATE_READY;
  }
  Serial.println(F("FINE_COMPLETE"));
  sendStatus();
}

void processJogCommand(String params) {
  params.trim();

  if (params == "STOP") {
    stopJog(false);
    return;
  }

  if (currentState == STATE_EMERGENCY) {
    Serial.println(F("ERROR:EMERGENCY_ACTIVE"));
    return;
  }

  if (isMoving || testRunning || activeFine != JOG_NONE) {
    Serial.println(F("ERROR:ALREADY_MOVING"));
    return;
  }

  JogMotor requestedJog = JOG_NONE;
  if (params == "BACK_UP") requestedJog = JOG_BACK_UP;
  else if (params == "BACK_DOWN") requestedJog = JOG_BACK_DOWN;
  else if (params == "SIDE_LEFT") requestedJog = JOG_SIDE_LEFT;
  else if (params == "SIDE_RIGHT") requestedJog = JOG_SIDE_RIGHT;
  else if (params == "LEG_UP") requestedJog = JOG_LEG_UP;
  else if (params == "LEG_DOWN") requestedJog = JOG_LEG_DOWN;

  if (requestedJog == JOG_NONE) {
    Serial.println(F("ERROR:INVALID_JOG_COMMAND"));
    return;
  }

  const bool sideJog = requestedJog == JOG_SIDE_LEFT || requestedJog == JOG_SIDE_RIGHT;
  if ((sideJog && (currentPos.backLevel != 0 || currentPos.legLevel != 5)) ||
      (!sideJog && currentPos.sideLevel != 5)) {
    Serial.println(F("ERROR:INTERLOCK"));
    return;
  }

  if (activeJog == requestedJog) {
    jogCommandTimer = millis();
    return;
  }

  if (activeJog != JOG_NONE) {
    stopJog(false);
  }

  if (jogAtLimit(requestedJog)) {
    activeJog = JOG_NONE;
    currentState = STATE_READY;
    Serial.println(F("ERROR:JOG_LIMIT"));
    sendStatus();
    return;
  }

  activeJog = requestedJog;
  currentState = STATE_MOVING;
  jogCommandTimer = millis();
  jogStepTimer = jogCommandTimer;
  startJogMotor(activeJog);
  Serial.println(F("JOGGING"));
  sendStatus();
}

void handleJog(unsigned long now) {
  if (activeJog == JOG_NONE) return;

  const JogMotor motor = activeJog;
  const unsigned long elapsed = now - jogStepTimer;
  jogStepTimer = now;
  if (updateJogProgress(motor, elapsed)) {
    stopJog(false, true);
    return;
  }

  if (now - jogCommandTimer >= JOG_COMMAND_TIMEOUT) {
    stopJog(true);
  }
}

long* jogProgressFor(JogMotor motor) {
  switch (motor) {
    case JOG_BACK_UP:
    case JOG_BACK_DOWN:
      return &backJogProgress;
    case JOG_SIDE_LEFT:
    case JOG_SIDE_RIGHT:
      return &sideJogProgress;
    case JOG_LEG_UP:
    case JOG_LEG_DOWN:
      return &legJogProgress;
    case JOG_NONE:
      return nullptr;
  }
  return nullptr;
}

int jogDirection(JogMotor motor) {
  switch (motor) {
    case JOG_BACK_UP:
    case JOG_SIDE_RIGHT:
    case JOG_LEG_UP:
      return 1;
    case JOG_BACK_DOWN:
    case JOG_SIDE_LEFT:
    case JOG_LEG_DOWN:
      return -1;
    case JOG_NONE:
      return 0;
  }
  return 0;
}

bool applyJogLevelDelta(JogMotor motor, int delta) {
  int* level = nullptr;
  switch (motor) {
    case JOG_BACK_UP:
    case JOG_BACK_DOWN:
      level = &currentPos.backLevel;
      break;
    case JOG_SIDE_LEFT:
    case JOG_SIDE_RIGHT:
      level = &currentPos.sideLevel;
      break;
    case JOG_LEG_UP:
    case JOG_LEG_DOWN:
      level = &currentPos.legLevel;
      break;
    case JOG_NONE:
      return false;
  }

  const int minimum = (motor == JOG_LEG_UP || motor == JOG_LEG_DOWN) ? -2 : 0;
  if (!level || *level + delta < minimum ||
      *level + delta > ((motor == JOG_BACK_UP || motor == JOG_BACK_DOWN) ? 8 : 10)) return false;
  *level += delta;
  return true;
}

bool updateJogProgress(JogMotor motor, unsigned long elapsed) {
  long* progress = jogProgressFor(motor);
  if (!progress) return false;
  const unsigned long stepDuration =
    (motor == JOG_BACK_UP || motor == JOG_BACK_DOWN) ? BACK_STEP_DELAY : STEP_DELAY;
  *progress += (long)jogDirection(motor) * (long)elapsed;

  bool changed = false;
  while (*progress >= (long)stepDuration || *progress <= -(long)stepDuration) {
    const int delta = *progress > 0 ? 1 : -1;
    if (!applyJogLevelDelta(motor, delta)) {
      *progress = 0;
      return true;
    }
    *progress -= (long)delta * (long)stepDuration;
    changed = true;
    if (jogAtLimit(motor)) {
      *progress = 0;
      if (changed) sendStatus();
      return true;
    }
  }

  if (changed) sendStatus();
  return false;
}

bool jogAtLimit(JogMotor motor) {
  switch (motor) {
    case JOG_BACK_UP: return currentPos.backLevel >= 8;
    case JOG_BACK_DOWN: return currentPos.backLevel <= 0;
    case JOG_SIDE_LEFT: return currentPos.sideLevel <= 0;
    case JOG_SIDE_RIGHT: return currentPos.sideLevel >= 10;
    case JOG_LEG_UP: return currentPos.legLevel >= 10;
    case JOG_LEG_DOWN: return currentPos.legLevel <= -2;
    case JOG_NONE: return true;
  }
  return true;
}

void startJogMotor(JogMotor motor) {
  switch (motor) {
    case JOG_BACK_UP: moveBackUp(); break;
    case JOG_BACK_DOWN: moveBackDown(); break;
    case JOG_SIDE_LEFT: moveSideLeft(); break;
    case JOG_SIDE_RIGHT: moveSideRight(); break;
    case JOG_LEG_UP: moveLegUp(); break;
    case JOG_LEG_DOWN: moveLegDown(); break;
    case JOG_NONE: stopAllMotors(); break;
  }
}

void stopJog(bool timedOut, bool hitLimit) {
  if (activeJog != JOG_NONE) {
    const JogMotor motor = activeJog;
    hitLimit = updateJogProgress(motor, millis() - jogStepTimer) || hitLimit;
    activeJog = JOG_NONE;
    stopAllMotors();
    if (currentState != STATE_EMERGENCY) {
      currentState = STATE_READY;
    }
    Serial.println(hitLimit ? F("JOG_LIMIT") :
      timedOut ? F("JOG_TIMEOUT") : F("JOG_STOPPED"));
    sendStatus();
    return;
  }

  Serial.println(F("JOG_STOPPED"));
  sendStatus();
}

void handleMovement(unsigned long now) {
  if (now - stepTimer < movementStepDuration) {
    return;
  }
  
  stopAllMotors();
  bool movementComplete = true;
  
  // Sequential movement: Back → Side → Leg
  
  // Back level control
  if (currentPos.backLevel != targetPos.backLevel) {
    movementStepDuration = BACK_STEP_DELAY;
    if (currentPos.backLevel < targetPos.backLevel) {
      moveBackUp();
      currentPos.backLevel++;
    } else {
      moveBackDown();
      currentPos.backLevel--;
    }
    Serial.print(F("Back: Level ")); Serial.println(currentPos.backLevel);
    movementComplete = false;
  }
  // Side level control
  else if (currentPos.sideLevel != targetPos.sideLevel) {
    movementStepDuration = STEP_DELAY;
    if (currentPos.sideLevel < targetPos.sideLevel) {
      moveSideRight();
      currentPos.sideLevel++;
    } else {
      moveSideLeft();
      currentPos.sideLevel--;
    }
    Serial.print(F("Side: Level ")); Serial.println(currentPos.sideLevel);
    movementComplete = false;
  }
  // Leg level control
  else if (currentPos.legLevel != targetPos.legLevel) {
    const int nextLegLevel = currentPos.legLevel +
      (currentPos.legLevel < targetPos.legLevel ? 1 : -1);
    movementStepDuration = STEP_DELAY +
      ((nextLegLevel == 5 && targetPos.legLevel == 5) ? LEG_RETURN_EXTRA_DELAY : 0);
    if (currentPos.legLevel < targetPos.legLevel) {
      moveLegUp();
      currentPos.legLevel++;
    } else {
      moveLegDown();
      currentPos.legLevel--;
    }
    Serial.print(F("Leg: Level ")); Serial.println(currentPos.legLevel);
    movementComplete = false;
  }
  
  if (movementComplete) {
    completeMovement();
  } else {
    stepTimer = now;
  }
}

void completeMovement() {
  if (sitPhase != SIT_NONE) {
    stopAllMotors();
    if (sitPhase == SIT_LEG_UP) {
      sitPhase = SIT_BACK_UP;
      targetPos.backLevel = 6;
    } else if (sitPhase == SIT_BACK_UP) {
      sitPhase = SIT_LEG_DOWN;
      targetPos.legLevel = 2;
    } else {
      sitPhase = SIT_NONE;
    }
    if (sitPhase != SIT_NONE) {
      startMovement();
      return;
    }
  }
  isMoving = false;
  currentState = STATE_READY;
  stopAllMotors();
  
  Serial.println(F("COMPLETE"));
  sendStatus();
  
  Serial.println(F("Movement completed successfully"));
}

// === Motor Control Functions ===
void setupMotorPins() {
  // Back motor PWM pins
  pinMode(BACK_PWM_F, OUTPUT);
  pinMode(BACK_PWM_R, OUTPUT);
  
  // Side motor PWM pins
  pinMode(SIDE_PWM_F, OUTPUT);
  pinMode(SIDE_PWM_R, OUTPUT);
  
  // Leg motor PWM pins
  pinMode(LEG_PWM_F, OUTPUT);
  pinMode(LEG_PWM_R, OUTPUT);
}

void moveBackUp() {
  analogWrite(BACK_PWM_F, MOTOR_SPEED);
  analogWrite(BACK_PWM_R, 0);
}

void moveBackDown() {
  analogWrite(BACK_PWM_F, 0);
  analogWrite(BACK_PWM_R, MOTOR_SPEED);
}

void moveSideLeft() {
  analogWrite(SIDE_PWM_F, MOTOR_SPEED);
  analogWrite(SIDE_PWM_R, 0);
}

void moveSideRight() {
  analogWrite(SIDE_PWM_F, 0);
  analogWrite(SIDE_PWM_R, MOTOR_SPEED);
}

void moveLegUp() {
  analogWrite(LEG_PWM_F, MOTOR_SPEED);
  analogWrite(LEG_PWM_R, 0);
}

void moveLegDown() {
  analogWrite(LEG_PWM_F, 0);
  analogWrite(LEG_PWM_R, MOTOR_SPEED);
}

void stopAllMotors() {
  // Stop all motors by setting PWM to 0
  analogWrite(BACK_PWM_F, 0);
  analogWrite(BACK_PWM_R, 0);
  analogWrite(SIDE_PWM_F, 0);
  analogWrite(SIDE_PWM_R, 0);
  analogWrite(LEG_PWM_F, 0);
  analogWrite(LEG_PWM_R, 0);
}

// === Safety Functions ===
void checkEmergencyButton() {
  static bool lastButtonState = HIGH;
  bool currentState = digitalRead(EMERGENCY_PIN);
  
  if (lastButtonState == HIGH && currentState == LOW) {
    activateEmergencyStop();
  }
  
  lastButtonState = currentState;
}

void activateEmergencyStop() {
  isMoving = false;
  testRunning = false;
  sitPhase = SIT_NONE;
  activeJog = JOG_NONE;
  activeFine = JOG_NONE;
  currentState = STATE_EMERGENCY;
  stopAllMotors();
  
  Serial.println(F("EMERGENCY"));
  sendStatus();
  
  Serial.println(F("EMERGENCY STOP ACTIVATED!"));
}

void resetSystem() {
  isMoving = false;
  sitPhase = SIT_NONE;
  activeJog = JOG_NONE;
  activeFine = JOG_NONE;
  currentState = STATE_READY;
  stopAllMotors();
  
  Serial.println(F("RESET_COMPLETE"));
  sendStatus();
  
  Serial.println(F("System reset - Emergency cleared"));
}

// === Status and Communication ===
void sendStatus() {
  // ✅ Format ที่ ESP32 คาดหวัง: STATUS:B5,S5,L7,READY
  Serial.print(F("STATUS:B"));
  Serial.print(currentPos.backLevel);
  Serial.print(F(",S"));
  Serial.print(currentPos.sideLevel);
  Serial.print(F(",L"));
  Serial.print(currentPos.legLevel);
  Serial.print(F(","));
  
  switch (currentState) {
    case STATE_READY:
      Serial.println(F("READY"));
      break;
    case STATE_MOVING:
      Serial.println(F("MOVING"));
      break;
    case STATE_EMERGENCY:
      Serial.println(F("EMERGENCY"));
      break;
  }
  
  Serial.flush();
  delay(10);
}

void clearSerialBuffer() {
  while (Serial.available()) {
    Serial.read();
  }
  delay(100);
}

void clearInputBuffer() {
  inputBuffer = "";
}

// === LED Control ===
void updateStatusLED() {
  unsigned long now = millis();
  
  switch (currentState) {
    case STATE_READY:
      digitalWrite(LED_STATUS, HIGH);  // Solid on - ready
      break;
      
    case STATE_MOVING:
      digitalWrite(LED_STATUS, (now % 1000) < 500);  // Slow blink - moving
      break;
      
    case STATE_EMERGENCY:
      digitalWrite(LED_STATUS, (now % 200) < 100);   // Fast blink - emergency
      break;
  }
}

const controls = [
  { id: 'a1', name: 'ยกพนักพิงหลัง', description: 'ยกส่วนบนของลำตัวขึ้น', range: '0–8 ระดับ (ประมาณ 0–56°)', timing: '5 วินาที/ระดับ · สูงสุด 40 วินาที', axis: 'back', max: 8, levelControl: true, angleScale: 7 },
  { id: 'a2', name: 'พลิกตัวซ้าย', description: 'ยกแผ่นรองครึ่งขวาจากพนักพิงถึงที่นั่ง', range: '0–5 ระดับ', timing: '5 วินาที/ระดับ · สูงสุด 25 วินาที', axis: 'tilt', direction: 1, max: 5, levelControl: true, angleScale: 4 },
  { id: 'a3', name: 'พลิกตัวขวา', description: 'ยกแผ่นรองครึ่งซ้ายจากพนักพิงถึงที่นั่ง', range: '0–5 ระดับ', timing: '5 วินาที/ระดับ · สูงสุด 25 วินาที', axis: 'tilt', direction: -1, max: 5, levelControl: true, angleScale: 4 },
  { id: 'a4', name: 'ปรับระดับขา', description: 'กด + เพื่อยกขาขึ้น · กด − เพื่อลดขาลง', range: '−7 ถึง +5 · ระดับ 0 คือแนวราบ', timing: 'แตะครั้งละ 5 วินาที · ขั้นสุดท้ายที่กลับ 0 เพิ่มอีก 2 วินาที', axis: 'legs', min: -7, max: 5, levelControl: true, angleScale: 14 },
  { id: 'a5', name: 'ท่านั่งขับถ่าย', description: 'ยกขา +1 → ยกพนักพิงถึง 6 → ลดขาถึง −3', range: 'เริ่มจากท่านอนราบ (พนักพิง 0 · เอียง 0 · ขา 0)' }
];

const step = 5;
const demoBackAngle = 42;
const demoLegAngle = 42;
const rates = { back: 1.4, tilt: 0.8, legs: 2.8, flat: 0.75 };
const shown = { back: 0, tilt: 0, legs: 0 };
const target = { ...shown };
const axes = Object.keys(shown);
const movements = new Map();
const formatAngle = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
const interlock = document.querySelector('#interlock');
const remaining = document.querySelector('#remaining');
let returningFlat = false;
let seatPhase = 0;
const controlList = document.querySelector('#control-list');
const activity = document.querySelector('#activity');
const reset = document.querySelector('#reset');
const canvas = document.querySelector('#bed');
const ctx = canvas.getContext('2d');
const backAngle = document.querySelector('#back-angle');
const tiltAngle = document.querySelector('#tilt-angle');
const legAngle = document.querySelector('#leg-angle');
const espConnectButton = document.querySelector('#connect-esp32');
const arduinoConnectButton = document.querySelector('#connect-arduino');
const disconnectButton = document.querySelector('#disconnect');
const rebaseButton = document.querySelector('#rebase');
const connectionStatus = document.querySelector('#connection-status');
const espStatus = document.querySelector('#esp32-status');
const arduinoStatus = document.querySelector('#arduino-status');
const modeLabel = document.querySelector('#mode-label');
const controlStep = document.querySelector('#control-step');
const returnSpec = document.querySelector('#return-spec');
const legLabel = document.querySelector('#leg-label');
const livePositionKeys = ['back', 'side', 'leg'];
const flatPosition = { back: 0, side: 5, leg: 5 };
const seatedPosition = { back: 6, side: 5, leg: 2 };
const levelStepDuration = 5000;
const statusTimeout = 15000;
const motionTimeout = 150000;
const holdDelay = 300;
const jogKeepAliveInterval = 200;
const simulationHoldInterval = 350;
let liveSession;
let activeControl;
let activeHold;
let pendingHold;
let finePulse;
let frame;

for (const control of controls) {
  const row = document.createElement('div');
  row.className = 'control';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', `title-${control.id}`);
  const incrementLabel = control.levelControl ? '1 ระดับ' : `${step}°`;
  const lowerAction = control.levelControl ? 'ลดระดับ' : 'ลดมุม';
  const raiseAction = control.levelControl ? 'เพิ่มระดับ' : 'เพิ่มมุม';
  const actions = control.max
    ? control.levelControl
      ? `<button type="button" class="adjust lower step" aria-label="${lowerAction} ${control.name} 1 ระดับ">−${incrementLabel}</button>
         <button type="button" class="adjust raise step" aria-label="${raiseAction} ${control.name} 1 ระดับ">+${incrementLabel}</button>
         <button type="button" class="adjust lower hold" aria-label="กดค้างเพื่อลดระดับ ${control.name}">กดค้าง ลดระดับ</button>
         <button type="button" class="adjust raise hold" aria-label="กดค้างเพื่อเพิ่มระดับ ${control.name}">กดค้าง เพิ่มระดับ</button>`
      : `<button type="button" class="adjust lower" aria-label="${lowerAction} ${control.name}">−${incrementLabel}</button>
         <button type="button" class="adjust raise" aria-label="${raiseAction} ${control.name}">+${incrementLabel}</button>`
    : '<button type="button" class="adjust raise preset">ใช้ท่าจำลอง</button>';
  row.innerHTML = `
    <div class="control-info">
      <span class="tile" aria-hidden="true">${control.id.toUpperCase()}</span>
      <div>
        <h3 id="title-${control.id}"><span class="sr-only">${control.id.toUpperCase()} </span><span data-control-name>${control.name}</span></h3>
        <p class="description">${control.description}</p>
        <p class="limits">${control.range}</p>
        ${control.timing ? `<p class="timing">${control.timing}</p>` : ''}
      </div>
    </div>
    <div class="control-actions">
      ${control.max ? '<span class="angle" data-angle>ระดับเป้าหมาย 0</span>' : ''}
      ${actions}
    </div>`;
  controlList.append(row);
  control.row = row;
  control.title = row.querySelector('[data-control-name]');
  control.details = row.querySelector('.description');
  control.limits = row.querySelector('.limits');
  control.rate = row.querySelector('.timing');
  control.raise = row.querySelector(control.levelControl ? '.step.raise' : '.raise');
  if (control.max) {
    control.lower = row.querySelector('.lower');
    control.value = row.querySelector('[data-angle]');
      if (control.levelControl) {
        control.holdRaise = row.querySelector('.hold.raise');
        control.holdLower = row.querySelector('.hold.lower');
        bindTapAdjustButton(control.raise, control, 1);
        bindTapAdjustButton(control.lower, control, -1);
        bindHoldButton(control.holdRaise, control, 1);
        bindHoldButton(control.holdLower, control, -1);
      } else {
        bindAdjustButton(control.raise, control, step);
        bindAdjustButton(control.lower, control, -step);
      }
  } else {
    control.raise.addEventListener('click', applySeatedPose);
  }
}

const fineRow = document.createElement('div');
fineRow.className = 'control fine-control';
fineRow.innerHTML = `
  <div class="control-info">
    <span class="tile" aria-hidden="true">A6</span>
    <div>
      <h3>ปรับละเอียด</h3>
      <p class="description">เลือก actuator แล้วกดหนึ่งครั้งให้ขยับ 2 วินาที</p>
      <p class="limits" id="fine-description">พนักพิง · − ลด / + ยก</p>
    </div>
  </div>
  <div class="fine-actions">
    <label for="fine-motor">เลือก actuator</label>
    <select id="fine-motor" aria-describedby="fine-description">
      <option value="back">พนักพิง</option>
      <option value="side">พลิกตัว</option>
      <option value="leg">ส่วนขา</option>
    </select>
    <div class="fine-buttons">
      <button type="button" class="adjust lower" id="fine-decrease" disabled>−2 วินาที</button>
      <button type="button" class="adjust raise" id="fine-increase" disabled>+2 วินาที</button>
    </div>
    <p class="fine-status" id="fine-status" role="status">เชื่อมต่อบอร์ดเพื่อใช้งาน</p>
  </div>`;
controlList.append(fineRow);
const fineMotor = fineRow.querySelector('#fine-motor');
const fineDescription = fineRow.querySelector('#fine-description');
const fineDecrease = fineRow.querySelector('#fine-decrease');
const fineIncrease = fineRow.querySelector('#fine-increase');
const fineStatus = fineRow.querySelector('#fine-status');
const fineDirections = {
  back: { lower: 'BACK_DOWN', raise: 'BACK_UP',
    description: 'พนักพิง · − ลด / + ยก', lowerLabel: 'ลดพนักพิง', raiseLabel: 'ยกพนักพิง' },
  side: { lower: 'SIDE_LEFT', raise: 'SIDE_RIGHT',
    description: 'พลิกตัว · − ซ้าย / + ขวา', lowerLabel: 'เอียงซ้าย', raiseLabel: 'เอียงขวา' },
  leg: { lower: 'LEG_DOWN', raise: 'LEG_UP',
    description: 'ส่วนขา · − ลด / + ยก', lowerLabel: 'ลดขา', raiseLabel: 'ยกขา' },
};
fineMotor.addEventListener('change', updateFineAvailability);
fineDecrease.addEventListener('click', () => startFinePulse(-1));
fineIncrease.addEventListener('click', () => startFinePulse(1));

window.addEventListener('pointerup', finishPointerHold);
window.addEventListener('pointercancel', finishPointerHold);
window.addEventListener('blur', stopInteractions);
window.addEventListener('pagehide', stopInteractions);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopInteractions();
});

function commandAngle(control) {
  if (control.axis === 'legs') return -target.legs / control.angleScale;
  return Math.max(0, target[control.axis] * (control.direction ?? 1) / (control.angleScale ?? 1));
}

function minimumLevel(control) {
  return control.min ?? 0;
}

function elevated() {
  return shown.back > 0 || shown.legs !== 0 || target.back > 0 || target.legs !== 0;
}

function tilted() {
  return shown.tilt !== 0 || target.tilt !== 0;
}

function locked(control) {
  return returningFlat || seatPhase !== 0 || (control.axis === 'tilt' ? elevated() : tilted());
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function setUnavailable(button, unavailable) {
  const value = String(unavailable);
  if (button.getAttribute('aria-disabled') !== value) button.setAttribute('aria-disabled', value);
}

function isUnavailable(button) {
  return button.disabled || button.getAttribute('aria-disabled') === 'true';
}

function setControlAvailability(control, raiseUnavailable, lowerUnavailable) {
  setUnavailable(control.raise, raiseUnavailable);
  setUnavailable(control.lower, lowerUnavailable);
  if (control.holdRaise) setUnavailable(control.holdRaise, raiseUnavailable);
  if (control.holdLower) setUnavailable(control.holdLower, lowerUnavailable);
}

function syncControls(now) {
  if (liveSession) {
    syncLiveControls();
    return;
  }
  rebaseButton.disabled = true;
  for (const control of controls) {
    control.row.classList.toggle('active', activeControl === control.id);
    const blocked = locked(control);
    if (!control.max) {
      setUnavailable(control.raise, blocked || movements.size > 0 ||
        axes.some(axis => shown[axis] !== 0 || target[axis] !== 0));
      continue;
    }
    const angle = commandAngle(control);
    setText(control.value, control.levelControl ? `ระดับเป้าหมาย ${angle}` : `เป้าหมาย ${angle}°`);
    control.row.classList.toggle('negative-level', control.axis === 'legs' && angle < 0);
    control.row.classList.toggle('raised-level', control.axis === 'legs' && angle > 0);
    setControlAvailability(control, blocked || angle >= control.max, blocked || angle <= minimumLevel(control));
  }

  setText(backAngle, `${formatAngle.format(shown.back)}°`);
  setText(legAngle, shown.legs < -0.05 ? `ยก ${formatAngle.format(-shown.legs)}°` :
    shown.legs > 0.05 ? `ลง ${formatAngle.format(shown.legs)}°` : '0°');
  const tiltDirection = shown.tilt > 0 ? 'ซ้าย' : 'ขวา';
  const tiltValue = Math.abs(shown.tilt);
  setText(tiltAngle, tiltValue >= 0.05 ? `${tiltDirection} ${formatAngle.format(tiltValue)}°` : '0°');
  reset.disabled = returningFlat || seatPhase !== 0 ||
    axes.every(axis => shown[axis] === 0 && target[axis] === 0);
  interlock.classList.toggle('locked', returningFlat || elevated() || tilted());
  let lockMessage = 'พลิกตัวได้ · พนักพิงและส่วนขาอยู่ในแนวราบ';
  if (returningFlat) {
    lockMessage = 'กำลังกลับท่านอนราบ · ปลดล็อกเมื่อเตียงถึงแนวราบ';
  } else if (elevated()) {
    lockMessage = 'ล็อก A2–A3 · พนักพิงและส่วนขาต้องกลับถึง 0° ก่อนพลิกตัว';
  } else if (tilted()) {
    lockMessage = 'ล็อก A1, A4, A5 · ตั้งมุมเอียงกลับเป็น 0° ก่อนปรับท่านั่ง';
  }
  setText(interlock, lockMessage);

  let wait = 0;
  for (const movement of movements.values()) wait = Math.max(wait, movement.end - now);
  setText(remaining, wait > 0 ? `เหลือประมาณ ${Math.ceil(wait / 1000)} วินาที` : '');
  updateFineAvailability();
}

function advance(now) {
  for (const [axis, movement] of movements) {
    if (now >= movement.end) {
      shown[axis] = target[axis];
      movements.delete(axis);
      continue;
    }
    const progress = Math.max(0, (now - movement.start) / (movement.end - movement.start));
    shown[axis] = movement.initial + (target[axis] - movement.initial) * progress;
  }
}

function move(axis, angle, rate, now) {
  target[axis] = angle === 0 ? 0 : angle;
  const duration = Math.abs(angle - shown[axis]) / rate * 1000;
  if (!duration) {
    movements.delete(axis);
    return;
  }
  movements.set(axis, { initial: shown[axis], start: now, end: now + duration });
}

function adjust(control, delta) {
  if (liveSession) {
    adjustLive(control, Math.sign(delta));
    return;
  }
  const now = performance.now();
  advance(now);
  if (locked(control)) return;
  const next = commandAngle(control) + delta;
  if (next < minimumLevel(control) || next > control.max) return;
  const nextAngle = control.axis === 'legs'
    ? -next * control.angleScale
    : next * (control.angleScale ?? 1) * (control.direction ?? 1);
  move(control.axis, nextAngle, rates[control.axis], now);
  update(control.id, control.levelControl
    ? `${control.name} · ระดับเป้าหมาย ${next}`
    : `${control.name} · เป้าหมาย ${next}° · ${rates[control.axis]}°/วินาที`, now);
}

function bindTapAdjustButton(button, control, delta) {
  button.addEventListener('click', event => {
    if (isUnavailable(button)) {
      event.preventDefault();
      return;
    }
    adjust(control, delta);
  });
}

function bindHoldButton(button, control, delta) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || isUnavailable(button)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    if (activeHold) stopActiveHold(true, true);
    beginHold({ button, control, delta, holdOnly: true,
      input: { type: 'pointer', pointerId: event.pointerId } });
  });
  button.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code) || event.repeat || isUnavailable(button)) return;
    event.preventDefault();
    if (activeHold) stopActiveHold(true, true);
    beginHold({ button, control, delta, holdOnly: true,
      input: { type: 'keyboard', key: event.code } });
  });
  button.addEventListener('keyup', event => {
    if (['Space', 'Enter'].includes(event.code)) finishKeyboardHold(button, control, delta, event.code);
  });
  button.addEventListener('click', event => event.preventDefault());
  button.addEventListener('contextmenu', event => event.preventDefault());
}

function bindAdjustButton(button, control, delta) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || isUnavailable(button)) return;
    queueHold(button, control, delta, { type: 'pointer', pointerId: event.pointerId });
  });
  button.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code) || event.repeat || isUnavailable(button)) return;
    event.preventDefault();
    queueHold(button, control, delta, { type: 'keyboard', key: event.code });
  });
  button.addEventListener('keyup', event => {
    if (!['Space', 'Enter'].includes(event.code)) return;
    finishKeyboardHold(button, control, delta, event.code);
  });
  button.addEventListener('click', event => {
    if (button.suppressNextClick) {
      button.suppressNextClick = false;
      event.preventDefault();
      return;
    }
    if (pendingHold?.button === button && pendingHold.input.type === 'keyboard') {
      event.preventDefault();
      return;
    }
    adjust(control, delta);
  });
  button.addEventListener('contextmenu', event => event.preventDefault());
}

function queueHold(button, control, delta, input) {
  cancelPendingHold();
  if (activeHold) stopActiveHold(true, true);
  const hold = { button, control, delta, input };
  pendingHold = hold;
  hold.timer = setTimeout(() => {
    if (pendingHold !== hold || isUnavailable(button)) {
      if (pendingHold === hold) pendingHold = undefined;
      return;
    }
    pendingHold = undefined;
    if (beginHold(hold)) suppressNextClick(button);
  }, holdDelay);
}

function beginHold(hold) {
  if (liveSession) {
    const data = liveStatus();
    const increment = Math.sign(hold.delta);
    if (!data || liveControlLocked(hold.control, data, increment) ||
        !jogWithinBounds(hold.control, increment, data.position)) return false;

    activeHold = { ...hold, session: liveSession, startedAt: Date.now() };
    activeControl = hold.control.id;
    void writeJogCommand(activeHold.session, jogCommandToken(hold.control, increment));
    activeHold.timer = setInterval(() => sendJogKeepAlive(activeHold), jogKeepAliveInterval);
    syncLiveControls();
    return true;
  }

  const current = commandAngle(hold.control);
  const next = current + Math.sign(hold.delta);
  if (locked(hold.control) || next < minimumLevel(hold.control) || next > hold.control.max) return false;

  activeHold = { ...hold, session: undefined };
  if (!hold.holdOnly) adjust(hold.control, hold.delta);
  const repeatInterval = hold.control.levelControl ? levelStepDuration : simulationHoldInterval;
  activeControl = hold.control.id;
  scheduleDrawing();
  activeHold.timer = setInterval(() => {
    if (activeHold?.button !== hold.button) return;
    if (isUnavailable(hold.button)) {
      stopActiveHold(false, true);
      return;
    }
    adjust(hold.control, hold.delta);
    if (isUnavailable(hold.button)) stopActiveHold(false, true);
  }, repeatInterval);
  return true;
}

function jogWithinBounds(control, increment, position) {
  const level = liveControlLevel(control, position);
  const max = control.max;
  return increment > 0 ? level < max : level > minimumLevel(control);
}

function jogCommandToken(control, increment) {
  if (control.axis === 'back') return increment > 0 ? 'BACK_UP' : 'BACK_DOWN';
  if (control.axis === 'tilt') return increment * control.direction > 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT';
  if (control.axis === 'legs') return increment > 0 ? 'LEG_UP' : 'LEG_DOWN';
  return increment > 0 ? 'LEG_UP' : 'LEG_DOWN';
}

function sendJogKeepAlive(hold) {
  if (!hold || activeHold !== hold || liveSession !== hold.session) return;
  const data = liveStatus();
  if (!data || !data.arduino_connected || data.status === 'EMERGENCY' ||
      data.mode !== 'MANUAL' || data.auto_mode?.demo_running) {
    stopActiveHold(true, true);
    return;
  }
  if ((data.receivedAt >= hold.startedAt && data.status !== 'MOVING') ||
      !jogWithinBounds(hold.control, Math.sign(hold.delta), data.position)) {
    stopActiveHold(true, true);
    return;
  }
  void writeJogCommand(hold.session, jogCommandToken(hold.control, Math.sign(hold.delta)));
}

function writeJogCommand(session, command) {
  if (liveSession !== session) return Promise.resolve();
  const line = session.kind === 'esp32' ? `JOG ${command}` : `JOG:${command}`;
  return session.client.writeLine(line).catch(() => {
    if (activeHold?.session === session) stopActiveHold(false, true);
    disconnectLiveClient(session, 'ส่งคำสั่งผ่าน COM ไม่สำเร็จ');
  });
}

function updateFineAvailability() {
  const axis = fineMotor.value;
  const config = fineDirections[axis];
  fineRow.classList.toggle('active', Boolean(finePulse));
  setText(fineDescription, config.description + (liveSession ? '' : ' · เชื่อมต่อบอร์ดเพื่อใช้งาน'));
  fineDecrease.setAttribute('aria-label', `${config.lowerLabel} 2 วินาที`);
  fineIncrease.setAttribute('aria-label', `${config.raiseLabel} 2 วินาที`);
  fineMotor.disabled = Boolean(finePulse);

  const data = liveSession ? liveStatus() : undefined;
  const blocked = !liveSession || Boolean(liveBlockReason(data)) || Boolean(finePulse);
  const position = data?.position;
  const interlocked = position && (axis === 'side'
    ? position.back !== 0 || position.leg !== 5
    : position.side !== 5);
  fineDecrease.disabled = blocked || interlocked;
  fineIncrease.disabled = blocked || interlocked;
}

function writeFineCommand(session, command) {
  if (liveSession !== session) return Promise.resolve();
  const line = session.kind === 'esp32' ? `FINE ${command}` : `FINE:${command}`;
  return session.client.writeLine(line).catch(() => {
    if (finePulse?.session === session) stopFinePulse(false);
    disconnectLiveClient(session, 'ส่งคำสั่งปรับละเอียดผ่าน COM ไม่สำเร็จ');
  });
}

function startFinePulse(direction) {
  updateFineAvailability();
  const button = direction > 0 ? fineIncrease : fineDecrease;
  if (button.disabled) return;

  const session = liveSession;
  const config = fineDirections[fineMotor.value];
  const pulse = { session, token: direction > 0 ? config.raise : config.lower };
  finePulse = pulse;
  activeControl = 'a6';
  session.feedback = `กำลัง${direction > 0 ? config.raiseLabel : config.lowerLabel} 2 วินาที`;
  setText(fineStatus, `กำลัง${direction > 0 ? config.raiseLabel : config.lowerLabel} · 2 วินาที`);
  updateFineAvailability();
  syncLiveControls();
  void writeFineCommand(session, pulse.token);
  pulse.timer = setTimeout(() => {
    if (finePulse !== pulse) return;
    stopFinePulse(true);
    setText(fineStatus, 'ไม่ได้รับผลยืนยันจากบอร์ด · ตรวจสอบสถานะอุปกรณ์');
  }, 5000);
}

function stopFinePulse(sendStop) {
  if (!finePulse) return;
  const pulse = finePulse;
  finePulse = undefined;
  clearTimeout(pulse.timer);
  if (sendStop && liveSession === pulse.session) void writeFineCommand(pulse.session, 'STOP');
  if (liveSession === pulse.session) {
    pulse.session.feedback = 'ปรับละเอียดเสร็จแล้ว · รอสถานะระดับล่าสุด';
    setText(fineStatus, 'ปรับครบ 2 วินาที · ค่าระดับหลักยังคงเดิม');
    syncLiveControls();
  }
  updateFineAvailability();
}

function stopActiveHold(sendStop, suppressClick) {
  if (!activeHold) return;
  const hold = activeHold;
  activeHold = undefined;
  clearInterval(hold.timer);
  if (suppressClick) suppressNextClick(hold.button);
  if (hold.session) {
    if (sendStop) void writeJogCommand(hold.session, 'STOP');
    if (liveSession === hold.session) syncLiveControls();
  }
}

function suppressNextClick(button) {
  button.suppressNextClick = true;
  setTimeout(() => { button.suppressNextClick = false; }, 500);
}

function cancelPendingHold(input) {
  if (!pendingHold || (input && !sameHoldInput(pendingHold.input, input))) return;
  clearTimeout(pendingHold.timer);
  pendingHold = undefined;
}

function sameHoldInput(left, right) {
  return left.type === right.type &&
    (left.type === 'pointer' ? left.pointerId === right.pointerId : left.key === right.key);
}

function finishPointerHold(event) {
  const input = { type: 'pointer', pointerId: event.pointerId };
  cancelPendingHold(input);
  if (activeHold?.input.type === 'pointer' &&
      sameHoldInput(activeHold.input, input)) stopActiveHold(true, true);
}

function finishKeyboardHold(button, control, delta, key) {
  const input = { type: 'keyboard', key };
  if (pendingHold?.button === button && sameHoldInput(pendingHold.input, input)) {
    cancelPendingHold(input);
    suppressNextClick(button);
    adjust(control, delta);
    return;
  }
  if (activeHold?.button === button && sameHoldInput(activeHold.input, input)) {
    stopActiveHold(true, true);
  }
}

function stopInteractions() {
  cancelPendingHold();
  stopActiveHold(true, true);
  stopFinePulse(true);
}

function applySeatedPose() {
  if (liveSession) {
    if (!liveControlLocked(controls.find(control => control.id === 'a5'), liveStatus())) {
      sendLiveMovement({ command: 'PRESET', preset: 'SIT' }, seatedPosition, 'a5');
    }
    return;
  }
  const now = performance.now();
  advance(now);
  if (returningFlat || seatPhase || movements.size ||
      axes.some(axis => shown[axis] !== 0 || target[axis] !== 0)) return;
  seatPhase = 1;
  move('legs', -14, rates.legs, now);
  update('a5', 'ท่านั่ง · ขั้น 1/3 ยกขาจากระดับ 0 เป็น +1', now);
}

function update(id, message, now) {
  activeControl = id;
  setText(activity, message);
  syncControls(now);
  scheduleDrawing();
}

reset.addEventListener('click', () => {
  if (liveSession) {
    sendLiveMovement({ command: 'PRESET', preset: 'FLAT' }, flatPosition);
    return;
  }
  if (returningFlat) return;
  const now = performance.now();
  advance(now);
  for (const axis of axes) move(axis, 0, rates.flat, now);
  returningFlat = movements.size > 0;
  update(undefined, returningFlat ? `กำลังกลับท่านอนราบ · ${rates.flat}°/วินาที` : 'เตียงอยู่ในแนวราบ', now);
  controls.find(control => control.id === 'a2').raise.focus();
});

function scheduleDrawing() {
  if (frame === undefined) frame = requestAnimationFrame(drawFrame);
}

function drawFrame(timestamp) {
  frame = undefined;
  const hadMotion = movements.size > 0;
  advance(timestamp);
  if (!movements.size && seatPhase === 1) {
    seatPhase = 2;
    move('back', demoBackAngle, rates.back, timestamp);
    setText(activity, 'ท่านั่ง · ขั้น 2/3 ยกพนักพิงถึงระดับ 6');
  } else if (!movements.size && seatPhase === 2) {
    seatPhase = 3;
    move('legs', demoLegAngle, rates.legs, timestamp);
    setText(activity, 'ท่านั่ง · ขั้น 3/3 ลดขาถึงระดับ −3');
  } else if (!movements.size && seatPhase === 3) {
    seatPhase = 0;
    setText(activity, 'ท่านั่งเสร็จแล้ว · พนักพิง 6 · ขา −3');
  } else if (!movements.size && (hadMotion || returningFlat)) {
    setText(activity, returningFlat ? 'เตียงกลับถึงแนวราบแล้ว' : 'ปรับมุมถึงเป้าหมายแล้ว');
    returningFlat = false;
  }
  syncControls(timestamp);
  drawBed();
  if (movements.size) scheduleDrawing();
}

function updateControlLabels(live) {
  setText(modeLabel, live ? 'โหมดควบคุมอุปกรณ์' : 'โหมดจำลอง');
  setText(controlStep, live
    ? 'แตะ −/+ เพื่อปรับ 1 ระดับ · ใช้ปุ่ม “กดค้าง” แล้วปล่อยเพื่อหยุด'
    : 'แตะ −/+ เพื่อปรับ 1 ระดับ · ใช้ปุ่ม “กดค้าง” เพื่อขยับต่อเนื่อง');
  setText(returnSpec, live ? 'ภาพแสดงท่าโดยประมาณตามระดับที่อุปกรณ์รายงาน' :
    'กลับท่านอนราบ 0.5–1°/วินาที · เวลาขึ้นกับมุมเริ่มต้น');
  setText(legLabel, live ? 'ส่วนขา · แนวราบ 0' : 'ส่วนขา');

  for (const control of controls) {
    const legControl = control.id === 'a4';
    const seatedControl = control.id === 'a5';
    const name = live && legControl ? 'ปรับส่วนขา' : live && seatedControl ? 'ท่านั่ง' : control.name;
    setText(control.title, name);
    setText(control.details, control.description);
    setText(control.limits, live ? (seatedControl || legControl || control.axis === 'back' ?
      control.range : 'ระดับ 0–5 จากแนวราบ') : control.range);
    if (control.rate) control.rate.hidden = false;
    if (!control.max) {
      setText(control.raise, live ? 'ใช้ท่านั่ง' : 'ใช้ท่าจำลอง');
      continue;
    }
    setText(control.raise, '+1 ระดับ');
    setText(control.lower, '−1 ระดับ');
    control.raise.setAttribute('aria-label', legControl ? 'ยกขาขึ้น 1 ระดับ' : `เพิ่มระดับ ${name}`);
    control.lower.setAttribute('aria-label', legControl ? 'ลดขาลง 1 ระดับ' : `ลดระดับ ${name}`);
    if (legControl) {
      setText(control.raise, '+1 ยกขา');
      setText(control.lower, '−1 ลดขา');
      control.holdRaise.setAttribute('aria-label', 'กดค้างเพื่อยกขาขึ้น ปล่อยเพื่อหยุด');
      control.holdLower.setAttribute('aria-label', 'กดค้างเพื่อลดขาลง ปล่อยเพื่อหยุด');
    }
  }
}

function samePosition(left, right) {
  return livePositionKeys.every(axis => left[axis] === right[axis]);
}

function liveStatus() {
  const latest = liveSession.latest;
  const age = latest ? Date.now() - latest.receivedAt : Infinity;
  return liveSession.client?.connected && age >= 0 && age < statusTimeout ? latest : undefined;
}

function liveBlockReason(data, allowJog = false) {
  if (!data) return 'รอสถานะล่าสุดจาก ESP32';
  if (!data.arduino_connected) return 'ESP32 ยังไม่ได้เชื่อมต่อ Arduino Uno';
  if (data.status === 'EMERGENCY') return 'อุปกรณ์รายงานสถานะหยุดฉุกเฉิน';
  if (data.mode !== 'MANUAL' || data.auto_mode?.demo_running === true) return 'เตียงต้องอยู่ในโหมดควบคุมด้วยตนเอง';
  if (liveSession.pending) return 'รอ Arduino รายงานผลคำสั่ง';
  if (finePulse) return 'กำลังปรับละเอียด';
  if (data.status !== 'READY' && !(allowJog && data.status === 'MOVING')) {
    return 'อุปกรณ์รายงานว่ากำลังขยับ';
  }
  return '';
}

function liveControlLocked(control, data, increment = 1) {
  const allowJog = activeHold?.session === liveSession && activeHold.control === control;
  if (liveBlockReason(data, allowJog)) return true;
  const { back, side, leg } = data.position;
  if (!control.max) return !samePosition(data.position, flatPosition);
  return control.axis === 'tilt' ? increment > 0 && (back !== 0 || leg !== 5) : side !== 5;
}

function liveControlLevel(control, position) {
  if (control.axis === 'tilt') return Math.max(0, (5 - position.side) * control.direction);
  if (control.axis === 'legs') return position.leg - 5;
  return position.back;
}

function syncLiveControls() {
  const data = liveStatus();
  const { phase, feedback } = liveSession;
  const blocked = liveBlockReason(data);
  const latest = data?.position;
  const side = latest?.side;
  const isEsp32 = liveSession.kind === 'esp32';
  const busLabel = data ? (isEsp32
    ? (data.arduino_connected ? 'ผ่าน · ESP32 และ Arduino Uno เชื่อมต่อแล้ว' : 'ไม่ผ่าน · ESP32 ติดต่อ Arduino Uno ไม่ได้')
    : 'เชื่อมต่อ Arduino Uno ผ่าน COM แล้ว') :
    phase === 'online' ? `เชื่อมต่อ ${isEsp32 ? 'ESP32' : 'Arduino Uno'} ผ่าน COM แล้ว · กำลังรอสถานะ` : phase;
  setText(connectionStatus, busLabel);
  setText(espStatus, isEsp32 ? 'ESP32: เชื่อมต่อผ่าน COM' : 'ESP32: ไม่ได้เลือกเชื่อมต่อ');
  setText(arduinoStatus, isEsp32
    ? `Arduino Uno: ${data?.arduino_connected ? 'เชื่อมต่อผ่าน ESP32' : data ? 'ESP32 ติดต่อไม่ได้' : 'รอสถานะจาก ESP32'}`
    : 'Arduino Uno: เชื่อมต่อผ่าน COM');
  setText(activity, feedback || (data ? 'แสดงตำแหน่งล่าสุดจาก ESP32' : 'กำลังรอสถานะจาก ESP32'));
  rebaseButton.disabled = Boolean(blocked);
  setText(returnSpec, latest ? 'ภาพแสดงท่าโดยประมาณตามระดับที่อุปกรณ์รายงาน' :
    liveSession.latest ? 'ภาพแสดงท่าจากข้อมูลรอบก่อน · กำลังรอสถานะปัจจุบัน' :
    'ภาพประกอบ · ยังไม่มีข้อมูลตำแหน่งจากอุปกรณ์');
  setText(backAngle, latest ? `ระดับ ${latest.back}` : '—');
  setText(tiltAngle, latest ? `ระดับ ${Math.abs(side - 5)} · ${side < 5 ? 'ซ้าย' : side > 5 ? 'ขวา' : 'กึ่งกลาง'}` : '—');
  setText(legAngle, latest ? `ระดับ ${latest.leg - 5}` : '—');
  setText(remaining, '');
  reset.disabled = Boolean(blocked) || samePosition(latest, flatPosition);

  let lockMessage = blocked || 'พร้อมส่งคำสั่งปรับเตียง';
  if (!blocked && latest.side !== 5) {
    lockMessage = 'ตั้งระดับเอียงกลับเป็น 0 ก่อนปรับพนักพิงหรือส่วนขา';
  } else if (!blocked && (latest.back !== 0 || latest.leg !== 5)) {
    lockMessage = 'ปรับพนักพิงและส่วนขาเป็นระดับ 0 ก่อนเอียงเตียง';
  }
  setText(interlock, lockMessage);
  interlock.classList.toggle('locked', lockMessage !== 'พร้อมส่งคำสั่งปรับเตียง');

  for (const control of controls) {
    control.row.classList.toggle('active', activeControl === control.id);
    const locked = liveControlLocked(control, data);
    if (!control.max) {
      setUnavailable(control.raise, locked);
      continue;
    }
    const level = latest ? liveControlLevel(control, latest) : 0;
    const oppositeTilt = control.axis === 'tilt' && latest && (5 - latest.side) * control.direction < 0;
    control.row.classList.toggle('negative-level', control.axis === 'legs' && level < 0);
    control.row.classList.toggle('raised-level', control.axis === 'legs' && level > 0);
    setText(control.value, latest ? `ระดับ ${level}` : '—');
    setControlAvailability(
      control,
      locked || oppositeTilt || level >= control.max,
      liveControlLocked(control, data, -1) || level <= minimumLevel(control)
    );
  }
  updateFineAvailability();
}

function adjustLive(control, increment) {
  const data = liveStatus();
  if (liveControlLocked(control, data, increment)) return;
  const position = { ...data.position };
  const next = liveControlLevel(control, position) + increment;
  if (next < minimumLevel(control) || next > control.max) return;
  if (control.axis === 'tilt') {
    if ((5 - position.side) * control.direction < 0) return;
    position.side = 5 - next * control.direction;
  } else if (control.axis === 'legs') {
    position.leg = next + 5;
  } else {
    position.back = next;
  }
  sendLiveMovement({ command: 'MOVE', ...position }, position, control.id);
}

function sendLiveMovement(command, destination, id) {
  const session = liveSession;
  const data = liveStatus();
  if (liveBlockReason(data) || samePosition(data.position, destination)) return;
  if (command.preset === 'SIT' && !samePosition(data.position, flatPosition)) return;

  const pending = { destination, expiresAt: Date.now() + motionTimeout };
  session.pending = pending;
  session.feedback = 'รออุปกรณ์รายงานระดับเป้าหมาย';
  activeControl = id;
  syncLiveControls();
  scheduleDrawing();
  const line = session.kind === 'esp32'
    ? (command.command === 'PRESET' ? `PRESET ${command.preset}` : `MOVE ${destination.back},${destination.side},${destination.leg}`)
    : (command.preset === 'SIT' ? 'SIT' :
      `MOVE:${destination.back},${destination.side},${destination.leg}`);
  session.client.writeLine(line).catch(() => {
    if (liveSession !== session || session.pending !== pending) return;
    session.pending = undefined;
    session.latest = undefined;
    session.feedback = 'ส่งคำสั่งผ่าน COM ไม่สำเร็จ';
    syncLiveControls();
  });
}

rebaseButton.addEventListener('click', () => {
  const session = liveSession;
  const data = session && liveStatus();
  if (!session || liveBlockReason(data)) return;

  const pending = { action: 'rebase', destination: flatPosition, expiresAt: Date.now() + 10000 };
  session.pending = pending;
  session.feedback = 'กำลังตั้งระดับอ้างอิงใหม่ · มอเตอร์ไม่ขยับ';
  syncLiveControls();
  session.client.writeLine('REBASE').catch(() => {
    if (liveSession !== session || session.pending !== pending) return;
    session.pending = undefined;
    session.feedback = 'ส่งคำสั่งตั้งระดับอ้างอิงไม่สำเร็จ';
    syncLiveControls();
  });
});

function receiveLiveStatus(session, data) {
  if (typeof data.arduino_connected !== 'boolean' ||
      !['READY', 'MOVING', 'EMERGENCY'].includes(data.status) ||
      !['MANUAL', 'AUTO'].includes(data.mode) ||
      typeof data.auto_mode?.demo_running !== 'boolean' ||
      !livePositionKeys.every(axis => Number.isInteger(data.position?.[axis]) &&
        data.position[axis] >= (axis === 'leg' ? -2 : 0) &&
        data.position[axis] <= (axis === 'back' ? 8 : 10))) return;

  const { back, side, leg } = data.position;
  session.latest = { ...data, position: { back, side, leg }, receivedAt: Date.now() };
  shown.back = back * 7;
  shown.tilt = (5 - side) * 4;
  shown.legs = (5 - leg) * 14;

  const hold = activeHold;
  if (hold?.session === session &&
      (!data.arduino_connected || data.status === 'EMERGENCY' ||
       data.mode !== 'MANUAL' || data.auto_mode.demo_running ||
       (session.latest.receivedAt >= hold.startedAt && data.status !== 'MOVING') ||
       !jogWithinBounds(hold.control, Math.sign(hold.delta), session.latest.position))) {
    stopActiveHold(true, true);
  }

  if (session.pending) {
    if (data.status === 'READY' && data.arduino_connected &&
        samePosition(session.latest.position, session.pending.destination)) {
      const rebased = session.pending.action === 'rebase';
      session.pending = undefined;
      session.feedback = rebased ? 'ตั้งระดับอ้างอิงใหม่แล้ว · พนักพิง เอียงตัว และขาเป็น 0' :
        'Arduino รายงานระดับตรงกับเป้าหมาย';
      if (rebased) activeControl = undefined;
    } else if (data.status === 'EMERGENCY' || !data.arduino_connected) {
      session.pending = undefined;
      session.feedback = 'ยืนยันผลการขยับไม่ได้ · ตรวจสอบสถานะอุปกรณ์';
    }
  }
  syncLiveControls();
  scheduleDrawing();
}

function disconnectLiveClient(session, message) {
  if (liveSession !== session) return;
  if (activeHold?.session === session) stopActiveHold(true, true);
  if (finePulse?.session === session) stopFinePulse(true);
  setText(fineStatus, 'เชื่อมต่อบอร์ดเพื่อใช้งาน');
  cancelPendingHold();
  liveSession = undefined;
  clearInterval(session.timer);
  void session.client?.close();
  session.latest = undefined;
  session.pending = undefined;
  espConnectButton.disabled = false;
  arduinoConnectButton.disabled = false;
  disconnectButton.disabled = true;
  rebaseButton.disabled = true;
  setText(espStatus, 'ESP32: ยังไม่เชื่อมต่อ');
  setText(arduinoStatus, 'Arduino Uno: ยังไม่เชื่อมต่อ');
  setText(connectionStatus, message);
  session.feedback = 'ไม่มีข้อมูลตำแหน่งจากอุปกรณ์';
  updateControlLabels(false);
  for (const axis of axes) {
    shown[axis] = 0;
    target[axis] = 0;
  }
  update(undefined, message, performance.now());
}

function tickLiveSession(session) {
  if (liveSession !== session) return;
  if (session.pending && Date.now() >= session.pending.expiresAt) {
    session.pending = undefined;
    session.latest = undefined;
    session.feedback = 'หมดเวลารอผลคำสั่ง · ตรวจสอบสถานะอุปกรณ์';
  }
  const pollInterval = activeHold?.session === session ? 1000 : session.kind === 'esp32' ? 3000 : 2000;
  if (!session.lastPoll || Date.now() - session.lastPoll >= pollInterval) {
    session.lastPoll = Date.now();
    session.client.writeLine('STATUS').catch(() => disconnectLiveClient(session, 'ส่งคำสั่งผ่าน COM ไม่สำเร็จ'));
  }
  syncLiveControls();
}

function serialLine(session, rawLine) {
  const line = rawLine.trim();
  if (!line || liveSession !== session) return;

  if (finePulse?.session === session && line.includes('FINE_COMPLETE')) {
    stopFinePulse(false);
  } else if (finePulse?.session === session && line.includes('ERROR:')) {
    stopFinePulse(false);
    setText(fineStatus, 'บอร์ดไม่รับคำสั่งปรับละเอียด · ตรวจสอบสถานะ');
  }

  if (session.kind === 'arduino') {
    const match = line.match(/^STATUS:B(-?\d+),S(-?\d+),L(-?\d+),(READY|MOVING|EMERGENCY)$/i);
    if (!match) return;
    receiveLiveStatus(session, {
      arduino_connected: true,
      mode: 'MANUAL',
      auto_mode: { demo_running: false },
      status: match[4].toUpperCase(),
      position: { back: Number(match[1]), side: Number(match[2]), leg: Number(match[3]) },
    });
    return;
  }

  if (line.includes('ENHANCED SYSTEM STATUS')) session.report = {};
  const report = session.report ??= {};
  let match;
  if ((match = line.match(/Arduino:\s*(Connected|Disconnected)\b/i))) {
    report.arduino_connected = match[1].toLowerCase() === 'connected';
  }
  if ((match = line.match(/Position:.*?\((-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\)/i))) {
    report.position = { back: Number(match[1]), side: Number(match[2]), leg: Number(match[3]) };
  }
  if ((match = line.match(/Bed Status:\s*(READY|MOVING|EMERGENCY)\b/i))) {
    report.status = match[1].toUpperCase();
  }
  if (/Auto Mode:.*Enabled/i.test(line)) report.mode = 'AUTO';
  else if (/Auto Mode:.*Disabled/i.test(line)) report.mode = 'MANUAL';
  if (/Demo Running:.*Yes/i.test(line)) report.demo_running = true;
  else if (/Demo Running:.*No/i.test(line)) report.demo_running = false;

  if (typeof report.arduino_connected === 'boolean' && report.position && report.status &&
      report.mode && typeof report.demo_running === 'boolean') {
    receiveLiveStatus(session, {
      arduino_connected: report.arduino_connected,
      mode: report.mode,
      auto_mode: { demo_running: report.demo_running },
      status: report.status,
      position: report.position,
    });
  }
}

async function readSerial(session) {
  const client = session.client;
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    const reader = client.port.readable.getReader();
    client.reader = reader;
    while (liveSession === session && client.connected) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) serialLine(session, line);
    }
    if (buffered) serialLine(session, buffered);
  } catch {
    if (liveSession === session) disconnectLiveClient(session, 'อ่านข้อมูล COM ไม่สำเร็จ');
  } finally {
    try { client.reader?.releaseLock(); } catch {}
    client.reader = undefined;
    if (liveSession === session && client.connected) {
      disconnectLiveClient(session, 'การเชื่อมต่อ COM สิ้นสุด');
    }
  }
}

async function connectSerial(kind) {
  if (liveSession) return;
  if (!navigator.serial || !globalThis.isSecureContext) {
    setText(connectionStatus, 'เบราว์เซอร์นี้ไม่รองรับ Web Serial · เปิดผ่าน Chrome หรือ Edge ที่ localhost');
    return;
  }

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (error) {
    if (error.name !== 'NotFoundError') setText(connectionStatus, 'เลือกพอร์ต COM ไม่สำเร็จ');
    return;
  }
  if (liveSession) return;
  try {
    await port.open({ baudRate: 115200 });
  } catch {
    setText(connectionStatus, 'เปิดพอร์ต COM ไม่สำเร็จ · ปิด Serial Monitor ที่ใช้พอร์ตนี้ก่อน');
    return;
  }

  const client = {
    port,
    connected: true,
    writeChain: Promise.resolve(),
    writeLine(line) {
      this.writeChain = this.writeChain.catch(() => {}).then(async () => {
        if (!this.connected || !port.writable) throw new Error('COM disconnected');
        const writer = port.writable.getWriter();
        try { await writer.write(new TextEncoder().encode(`${line}\n`)); }
        finally { writer.releaseLock(); }
      });
      return this.writeChain;
    },
    async close() {
      if (!this.connected) return;
      this.connected = false;
      try { await this.reader?.cancel(); } catch {}
      try { await this.writeChain; } catch {}
      try { await session.readerTask; } catch {}
      try { await port.close(); } catch {}
    },
  };
  const session = { kind, client, phase: 'online', lastPoll: 0 };
  liveSession = session;
  setText(fineStatus, 'พร้อมปรับละเอียด · เลือก actuator แล้วกดหนึ่งครั้ง');
  movements.clear();
  returningFlat = false;
  seatPhase = 0;
  activeControl = undefined;
  Object.assign(shown, { back: 0, tilt: 0, legs: 0 });
  espConnectButton.disabled = true;
  arduinoConnectButton.disabled = true;
  disconnectButton.disabled = false;
  rebaseButton.disabled = true;
  updateControlLabels(true);
  syncLiveControls();
  scheduleDrawing();
  session.timer = setInterval(() => tickLiveSession(session), 1000);
  session.readerTask = readSerial(session);
  tickLiveSession(session);
}

espConnectButton.addEventListener('click', () => void connectSerial('esp32'));
arduinoConnectButton.addEventListener('click', () => void connectSerial('arduino'));

disconnectButton.addEventListener('click', () => {
  if (!liveSession) return;
  const session = liveSession;
  disconnectLiveClient(session, 'ตัดการเชื่อมต่อ COM แล้ว · โหมดจำลอง');
});
function project(x, y, z = 0) {
  return [212 + x * 0.92 - y * 0.93, 146 + x * 0.23 + y * 0.45 - z];
}

function polygon(points, fill, stroke) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function line(start, end, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(...start);
  ctx.lineTo(...end);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.lineWidth = 1;
}

function surface(points, depth, light, shade, edge) {
  const lower = points.map(([x, y]) => [x, y + depth]);
  for (const [a, b] of [[1, 2], [2, 3], [3, 0]]) {
    polygon([points[a], points[b], lower[b], lower[a]], shade, edge);
  }
  polygon(points, light, edge);
}

const panels = [
  { start: 0, end: 133, hinge: 133, joint: 'back', color: '#cbdcf8', label: 'พนักพิง', control: 'a1' },
  { start: 133, end: 217, hinge: 217, color: '#bacfee', label: 'ที่นั่ง' },
  { start: 217, end: 350, hinge: 217, joint: 'legs', color: '#cbdcf8', label: 'ส่วนขา', control: 'a4' }
];

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function mattressPoint(panel, x, y, extraHeight = 0, roll = 0) {
  const angle = radians(shown[panel.joint] ?? 0);
  const along = x - panel.hinge;
  const height = -along * Math.sin(angle) + extraHeight;
  return project(panel.hinge + along * Math.cos(angle),
    y * Math.cos(roll) - height * Math.sin(roll),
    8 + y * Math.sin(roll) + height * Math.cos(roll));
}

function drawMattressHalf(panel, side) {
  const edge = side * 66;
  const minY = Math.min(0, edge);
  const maxY = Math.max(0, edge);
  // A positive roll lifts the patient's right half to turn the patient left.
  const lifted = side * shown.tilt > 0;
  const roll = lifted ? radians(shown.tilt) : 0;
  const point = (x, y, height = 0) => mattressPoint(panel, x, y, height, roll);
  const corners = [[panel.start, minY], [panel.end, minY], [panel.end, maxY], [panel.start, maxY]];
  const selected = panel.control && (panel.control === activeControl || activeControl === 'a5');
  const color = lifted ? '#93b9ff' : selected ? '#eff5ff' : panel.color;
  surface(corners.map(([x, y]) => point(x, y)), 12, color, '#667fa6', '#2f4568');

  const inset = [[panel.start + 4, minY + 3], [panel.end - 4, minY + 3],
    [panel.end - 4, maxY - 3], [panel.start + 4, maxY - 3]];
  polygon(inset.map(([x, y]) => point(x, y, 0.5)), '#ffffff12', '#8fa8cf');

  if (panel.joint === 'back') {
    const pillow = [[9, 0], [48, 0], [48, side * 25], [40, side * 33], [15, side * 33], [9, side * 26]];
    polygon(pillow.map(([x, y]) => point(x, y, 3)), '#f1f7ff', '#7894bd');
  }
}

function drawMattressLabel(panel, y) {
  const x = (panel.start + panel.end) / 2 + (panel.joint === 'back' ? 14 : 0);
  const [cx, cy] = mattressPoint(panel, x, y, 1);
  ctx.fillStyle = '#17213d';
  ctx.font = '650 17px "Thonburi", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(panel.label, cx, cy);
}

function bedEnd(point, x, height) {
  const outline = [[-73, -15], [73, -15], [73, height - 12], [63, height], [-63, height], [-73, height - 12]];
  polygon(outline.map(([y, z]) => point(x, y, z)), '#8da9d2', '#cfddf2');
  const inset = [[-57, -6], [57, -6], [57, height - 14], [-57, height - 14]];
  polygon(inset.map(([y, z]) => point(x, y, z)), '#476487', '#abc4e5');
  line(point(x, -26, height - 7), point(x, 26, height - 7), '#dce7f8', 4);
}

function sideRail(side) {
  const point = (x, z) => mattressPoint(panels[1], x, side * 74, z);
  const bars = [[84, 9], [84, 48], [95, 56], [214, 56], [226, 46], [226, 9]];
  for (let i = 1; i < bars.length; i++) {
    line(point(...bars[i - 1]), point(...bars[i]), '#97b2d7', 8);
    line(point(...bars[i - 1]), point(...bars[i]), '#e4effd', 4);
  }
  line(point(84, 33), point(226, 33), '#bdcee6', 5);
  for (const x of [100, 206]) line(point(x, 6), point(x, 33), '#819ec7', 6);
}

function drawBed() {
  if (!ctx) return;
  ctx.clearRect(0, 0, 720, 410);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let x = 20; x < 720; x += 24) {
    for (let y = 15; y < 405; y += 24) {
      ctx.fillStyle = '#95b3ff24';
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  const outline = [[-13, -75], [220, -75], [220, 75], [-13, 75]];
  polygon(outline.map(([x, y]) => project(x + 9, y + 5, -140)), '#070c2077');
  for (const [x, y] of [[2, -59], [205, -59], [2, 59], [205, 59]]) {
    line(project(x, y, -39), project(x, y, -124), '#7188b9', 10);
    line(project(x, y, -124), project(x + 14, y, -124), '#9fb0da', 8);
    const [wheelX, wheelY] = project(x + 13, y, -133);
    ctx.beginPath();
    ctx.arc(wheelX, wheelY, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#10203b';
    ctx.fill();
    ctx.strokeStyle = '#9eb5d8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(wheelX, wheelY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#8da7cd';
    ctx.fill();
  }

  // The stationary chassis is shown below the moving mattress sections.
  surface(outline.map(([x, y]) => project(x, y, -35)), 12, '#536b9c', '#26395d', '#7290bc');
  line(project(174, -47, -35), project(174, -47, 4), '#8199cc', 9);
  line(project(174, 47, -35), project(174, 47, 4), '#8199cc', 9);

  bedEnd(project, -17, 35);
  sideRail(-1);
  for (const panel of panels) {
    if (panel.joint === 'legs') {
      const corners = [[panel.start, -66], [panel.end, -66], [panel.end, 66], [panel.start, 66]];
      const selected = activeControl === 'a4' || activeControl === 'a5';
      surface(corners.map(([x, y]) => mattressPoint(panel, x, y)), 12,
        selected ? '#eff5ff' : panel.color, '#667fa6', '#2f4568');
      const inset = [[panel.start + 4, -61], [panel.end - 4, -61], [panel.end - 4, 61], [panel.start + 4, 61]];
      polygon(inset.map(([x, y]) => mattressPoint(panel, x, y, 0.5)), '#ffffff12', '#8fa8cf');
      drawMattressLabel(panel, 0);
    } else {
      drawMattressHalf(panel, -1);
      drawMattressHalf(panel, 1);
      drawMattressLabel(panel, shown.tilt < 0 ? 31 : -31);
    }
  }
  sideRail(1);
  bedEnd((x, y, z) => mattressPoint(panels[2], x, y, z), 358, 25);
}

updateControlLabels(false);
syncControls(performance.now());
drawBed();

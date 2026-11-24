const controls = [
  { id: 'a1', name: 'ยกพนักพิงหลัง', description: 'ยกส่วนบนของลำตัวขึ้น', range: '0–70°', timing: '1–2°/วินาที · 35–70 วินาที', axis: 'back', max: 70 },
  { id: 'a2', name: 'พลิกตัวซ้าย', description: 'ยกแผ่นรองครึ่งขวาจากพนักพิงถึงที่นั่ง', range: '0–20°', timing: '0.3–0.7°/วินาที · 29–67 วินาที', axis: 'tilt', direction: 1, max: 20 },
  { id: 'a3', name: 'พลิกตัวขวา', description: 'ยกแผ่นรองครึ่งซ้ายจากพนักพิงถึงที่นั่ง', range: '0–20°', timing: '0.3–0.7°/วินาที · 29–67 วินาที', axis: 'tilt', direction: -1, max: 20 },
  { id: 'a4', name: 'ปรับขาลง', description: 'ลดส่วนขาจากแนวนอนสู่ท่านั่ง', range: '0–70° จากแนวนอน', timing: '0.5–1°/วินาที · 70–140 วินาที', axis: 'legs', max: 70 },
  { id: 'a5', name: 'ท่านั่งขับถ่าย', description: 'ยกหลังพร้อมลดส่วนขาลง', range: 'หลัง 60–70° · ปรับขาตามสรีระ' }
];

const step = 5;
const demoBackAngle = 65;
const demoLegAngle = 60;
const rates = { back: 1.5, tilt: 0.5, legs: 0.75, flat: 0.75 };
const shown = { back: 0, tilt: 0, legs: 0 };
const target = { ...shown };
const axes = Object.keys(shown);
const movements = new Map();
const formatAngle = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
const interlock = document.querySelector('#interlock');
const remaining = document.querySelector('#remaining');
let returningFlat = false;
const controlList = document.querySelector('#control-list');
const activity = document.querySelector('#activity');
const reset = document.querySelector('#reset');
const canvas = document.querySelector('#bed');
const ctx = canvas.getContext('2d');
const backAngle = document.querySelector('#back-angle');
const tiltAngle = document.querySelector('#tilt-angle');
const legAngle = document.querySelector('#leg-angle');
const connectionForm = document.querySelector('#connection-form');
const brokerUrl = document.querySelector('#broker-url');
const brokerUsername = document.querySelector('#broker-username');
const brokerPassword = document.querySelector('#broker-password');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const switchMode = document.querySelector('#switch-mode');
const takeManualControl = document.querySelector('#take-manual-control');
const connectionStatus = document.querySelector('#connection-status');
const modeLabel = document.querySelector('#mode-label');
const previewTitle = document.querySelector('#preview-title');
const controlStep = document.querySelector('#control-step');
const returnSpec = document.querySelector('#return-spec');
const legLabel = document.querySelector('#leg-label');
const commandTopic = 'smartbed/command';
const statusTopic = 'smartbed/status';
const deviceId = 'ESP32_SmartBed_Enhanced';
const livePositionKeys = ['back', 'side', 'leg'];
const flatPosition = { back: 0, side: 5, leg: 5 };
const seatedPosition = { back: 7, side: 5, leg: 2 };
const statusTimeout = 15000;
const statusRequestInterval = 5000;
const motionTimeout = 80000;
let liveSession = { phase: 'ยังไม่ได้เชื่อมต่อเตียงจริง' };
let activeControl;
let frame;

for (const control of controls) {
  const row = document.createElement('div');
  row.className = 'control';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', `title-${control.id}`);
  const actions = control.max
    ? `<button type="button" class="adjust lower" aria-label="ลดมุม ${control.name}">−5°</button>
       <button type="button" class="adjust raise" aria-label="เพิ่มมุม ${control.name}">+5°</button>`
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
      ${control.max ? '<span class="angle" data-angle>เป้าหมาย 0°</span>' : ''}
      ${actions}
    </div>`;
  controlList.append(row);
  control.row = row;
  control.title = row.querySelector('[data-control-name]');
  control.details = row.querySelector('.description');
  control.limits = row.querySelector('.limits');
  control.rate = row.querySelector('.timing');
  control.raise = row.querySelector('.raise');
  if (control.max) {
    control.lower = row.querySelector('.lower');
    control.value = row.querySelector('[data-angle]');
    control.raise.addEventListener('click', () => adjust(control, step));
    control.lower.addEventListener('click', () => adjust(control, -step));
  } else {
    control.raise.addEventListener('click', applySeatedPose);
  }
}

function commandAngle(control) {
  return Math.max(0, target[control.axis] * (control.direction ?? 1));
}

function elevated() {
  return shown.back > 0 || shown.legs > 0 || target.back > 0 || target.legs > 0;
}

function tilted() {
  return shown.tilt !== 0 || target.tilt !== 0;
}

function locked(control) {
  return returningFlat || (control.axis === 'tilt' ? elevated() : tilted());
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function setUnavailable(button, unavailable) {
  const value = String(unavailable);
  if (button.getAttribute('aria-disabled') !== value) button.setAttribute('aria-disabled', value);
}

function syncControls(now) {
  if (liveSession) {
    syncLiveControls();
    return;
  }
  for (const control of controls) {
    control.row.classList.toggle('active', activeControl === control.id);
    const blocked = locked(control);
    if (!control.max) {
      setUnavailable(control.raise, blocked);
      continue;
    }
    const angle = commandAngle(control);
    setText(control.value, `เป้าหมาย ${angle}°`);
    setUnavailable(control.raise, blocked || angle === control.max);
    setUnavailable(control.lower, blocked || angle === 0);
  }

  setText(backAngle, `${formatAngle.format(shown.back)}°`);
  setText(legAngle, `${formatAngle.format(shown.legs)}°`);
  const tiltDirection = shown.tilt > 0 ? 'ซ้าย' : 'ขวา';
  const tiltValue = Math.abs(shown.tilt);
  setText(tiltAngle, tiltValue >= 0.05 ? `${tiltDirection} ${formatAngle.format(tiltValue)}°` : '0°');
  reset.disabled = returningFlat || axes.every(axis => shown[axis] === 0 && target[axis] === 0);
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
  if (next < 0 || next > control.max) return;
  move(control.axis, next * (control.direction ?? 1), rates[control.axis], now);
  update(control.id, `${control.name} · เป้าหมาย ${next}° · ${rates[control.axis]}°/วินาที`, now);
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
  if (returningFlat || tilted()) return;
  move('back', demoBackAngle, rates.back, now);
  move('legs', target.legs || demoLegAngle, rates.legs, now);
  update('a5', `ท่านั่งขับถ่ายจำลอง · เป้าหมายหลัง ${demoBackAngle}° · ขาลง ${target.legs}°`, now);
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
  if (!movements.size && (hadMotion || returningFlat)) {
    setText(activity, returningFlat ? 'เตียงกลับถึงแนวราบแล้ว' : 'ปรับมุมถึงเป้าหมายแล้ว');
    returningFlat = false;
  }
  syncControls(timestamp);
  drawBed();
  if (movements.size) scheduleDrawing();
}

function updateControlLabels(live) {
  setText(modeLabel, live ? 'โหมดควบคุมเตียงจริง' : 'โหมดจำลอง');
  setText(switchMode, live ? 'เปิดโหมดจำลอง' : 'กลับไปควบคุมเตียงจริง');
  setText(previewTitle, live ? 'ภาพแสดงตำแหน่งเตียง' : 'ภาพจำลองเตียง');
  setText(controlStep, live ? 'ปรับครั้งละ 1 ระดับ' : 'ปรับครั้งละ 5°');
  setText(returnSpec, live ? 'ภาพแสดงท่าโดยประมาณตามระดับที่อุปกรณ์รายงาน' :
    'กลับท่านอนราบ 0.5–1°/วินาที · เวลาขึ้นกับมุมเริ่มต้น');
  setText(legLabel, live ? 'ส่วนขา' : 'ขาต่ำกว่าแนวนอน');

  for (const control of controls) {
    const legControl = control.id === 'a4';
    const seatedControl = control.id === 'a5';
    const name = live && legControl ? 'ปรับส่วนขา' : live && seatedControl ? 'ท่านั่ง' : control.name;
    setText(control.title, name);
    setText(control.details, live && legControl ? 'เพิ่มระดับเพื่อยกขึ้น ลดระดับเพื่อปรับลง' :
      live && seatedControl ? 'ใช้ท่านั่งที่ตั้งไว้ใน ESP32' : control.description);
    setText(control.limits, live ? (seatedControl ? 'พนักพิงระดับ 7 · ส่วนขาระดับ 2' :
      control.direction ? 'ระดับการเอียง 0–5 จากกึ่งกลาง' : 'ระดับ 0–10') : control.range);
    if (control.rate) control.rate.hidden = live;
    if (!control.max) {
      setText(control.raise, live ? 'ใช้ท่านั่ง' : 'ใช้ท่าจำลอง');
      continue;
    }
    setText(control.raise, live ? '+1' : '+5°');
    setText(control.lower, live ? '−1' : '−5°');
    control.raise.setAttribute('aria-label', live ? `เพิ่มระดับ ${name}` : `เพิ่มมุม ${name}`);
    control.lower.setAttribute('aria-label', live ? `ลดระดับ ${name}` : `ลดมุม ${name}`);
  }
}

function matchesPosition(position, destination) {
  return Object.keys(destination).every(axis => position[axis] === destination[axis]);
}

function isAutomatic(data) {
  return data.mode === 'AUTO' || data.auto_mode.demo_running;
}

function liveStatus() {
  const latest = liveSession.latest;
  const age = latest ? Date.now() - latest.receivedAt : Infinity;
  return liveSession.client?.connected && age >= 0 && age < statusTimeout ? latest : undefined;
}

function liveBlockReason(data) {
  if (!liveSession.client) return 'เชื่อมต่อเตียงจริงก่อนปรับตำแหน่ง';
  if (!data) return 'รอสถานะล่าสุดจาก ESP32';
  if (!data.arduino_connected) return 'ESP32 ยังไม่ได้เชื่อมต่อ Arduino Uno';
  if (data.status === 'EMERGENCY') return 'อุปกรณ์รายงานสถานะหยุดฉุกเฉิน';
  if (isAutomatic(data)) return 'เปลี่ยนเป็นควบคุมด้วยตนเองก่อนสั่งปรับระดับ';
  if (liveSession.pending) return 'รอ Arduino รายงานผลคำสั่ง';
  if (data.status !== 'READY') return 'อุปกรณ์รายงานว่ากำลังขยับ';
  return '';
}

function liveControlLocked(control, data, increment = 1) {
  if (liveBlockReason(data)) return true;
  const { back, side, leg } = data.position;
  return control.direction ? increment > 0 && (back !== 0 || leg !== 5) : side !== 5;
}

function liveControlLevel(control, position) {
  if (control.direction) return Math.max(0, (5 - position.side) * control.direction);
  return position[control.axis === 'legs' ? 'leg' : 'back'];
}

function syncLiveControls() {
  const data = liveStatus();
  const { client, phase, feedback } = liveSession;
  const blocked = liveBlockReason(data);
  const latest = data?.position;
  const side = latest?.side;
  const busLabel = data ? 'เชื่อมต่อ MQTT และได้รับสถานะ ESP32' :
    phase === 'online' ? 'เชื่อมต่อ MQTT แล้ว · รอข้อมูลล่าสุดจาก ESP32' : phase;
  setText(connectionStatus, busLabel);
  disconnectButton.disabled = !client;
  takeManualControl.hidden = !data?.arduino_connected || !isAutomatic(data) || data.status === 'EMERGENCY';
  takeManualControl.disabled = !data || data.status !== 'READY' ||
    Boolean(liveSession.pending || liveSession.manualUntil);
  setText(activity, feedback || (data ? 'แสดงตำแหน่งล่าสุดจาก ESP32' :
    client ? 'กำลังรอสถานะจาก ESP32' : 'ยังไม่มีข้อมูลตำแหน่งเตียงจริง'));
  setText(returnSpec, latest ? 'ภาพแสดงท่าโดยประมาณตามระดับที่อุปกรณ์รายงาน' :
    'จะแสดงภาพเมื่อได้รับตำแหน่งล่าสุดจากอุปกรณ์');
  canvas.classList.toggle('position-unknown', !latest);
  setText(backAngle, latest ? `ระดับ ${latest.back}` : '—');
  setText(tiltAngle, latest ? `ระดับ ${latest.side} · ${side < 5 ? 'ซ้าย' : side > 5 ? 'ขวา' : 'กึ่งกลาง'}` : '—');
  setText(legAngle, latest ? `ระดับ ${latest.leg}` : '—');
  setText(remaining, '');
  reset.disabled = Boolean(blocked) || matchesPosition(latest, flatPosition);

  let lockMessage = blocked || 'พร้อมส่งคำสั่งปรับเตียง';
  if (!blocked && latest.side !== 5) {
    lockMessage = 'ตั้งระดับเอียงกลับเป็น 5 ก่อนปรับพนักพิงหรือส่วนขา';
  } else if (!blocked && (latest.back !== 0 || latest.leg !== 5)) {
    lockMessage = 'ปรับพนักพิงเป็นระดับ 0 และส่วนขาเป็นระดับ 5 ก่อนเอียงเตียง';
  }
  setText(interlock, lockMessage);
  interlock.classList.toggle('locked', lockMessage !== 'พร้อมส่งคำสั่งปรับเตียง');

  for (const control of controls) {
    control.row.classList.toggle('active', activeControl === control.id);
    const locked = liveControlLocked(control, data);
    if (!control.max) {
      setUnavailable(control.raise, locked || matchesPosition(latest, seatedPosition));
      continue;
    }
    const level = latest ? liveControlLevel(control, latest) : 0;
    const oppositeTilt = control.direction && latest && (5 - latest.side) * control.direction < 0;
    setText(control.value, latest ? (control.direction ? `เอียง ${level} ระดับ` : `ระดับ ${level}`) : '—');
    setUnavailable(control.raise, locked || oppositeTilt || level === (control.direction ? 5 : 10));
    setUnavailable(control.lower, liveControlLocked(control, data, -1) || level === 0);
  }
}

takeManualControl.addEventListener('click', () => {
  const session = liveSession;
  if (!session) return;
  const data = liveStatus();
  if (!data?.arduino_connected || !isAutomatic(data) || data.status !== 'READY' ||
      session.pending || session.manualUntil) return;

  session.manualUntil = Date.now() + statusTimeout;
  session.feedback = 'รอ ESP32 ยืนยันโหมดควบคุมด้วยตนเอง';
  syncLiveControls();
  session.client.publish(commandTopic, JSON.stringify({ command: 'AUTO', enable: false }),
    { qos: 0, retain: false }, error => {
      if (!error || liveSession !== session || !session.manualUntil) return;
      session.manualUntil = undefined;
      session.feedback = 'ส่งคำสั่งเปลี่ยนโหมดไม่สำเร็จ';
      syncLiveControls();
    });
});

function adjustLive(control, increment) {
  const data = liveStatus();
  if (liveControlLocked(control, data, increment)) return;
  const position = data.position;
  const next = liveControlLevel(control, position) + increment;
  if (next < 0 || next > (control.direction ? 5 : 10)) return;
  let change;
  if (control.direction) {
    if ((5 - position.side) * control.direction < 0) return;
    change = { side: 5 - next * control.direction };
  } else if (control.axis === 'legs') {
    change = { leg: next };
  } else {
    change = { back: next };
  }
  sendLiveMovement({ command: 'MOVE', ...change }, change, control.id);
}

function sendLiveMovement(command, destination, id) {
  const session = liveSession;
  const data = liveStatus();
  if (liveBlockReason(data) || matchesPosition(data.position, destination)) return;

  const pending = { destination, expiresAt: Date.now() + motionTimeout };
  session.pending = pending;
  session.feedback = 'รออุปกรณ์รายงานระดับเป้าหมาย';
  activeControl = id;
  syncLiveControls();
  scheduleDrawing();
  session.client.publish(commandTopic, JSON.stringify(command), { qos: 0, retain: false }, error => {
    if (!error || liveSession !== session || session.pending !== pending) return;
    session.pending = undefined;
    session.latest = undefined;
    session.feedback = 'ส่งคำสั่งไม่สำเร็จ · รอสถานะล่าสุดจากอุปกรณ์';
    syncLiveControls();
  });
}

function receiveLiveStatus(session, topic, message, packet) {
  if (topic !== statusTopic || packet?.retain !== false) return;
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch {
    return;
  }
  if (data?.device_id !== deviceId || typeof data.arduino_connected !== 'boolean' ||
      !['READY', 'MOVING', 'EMERGENCY'].includes(data.status) ||
      !['MANUAL', 'AUTO'].includes(data.mode) ||
      typeof data.auto_mode?.demo_running !== 'boolean' ||
      !livePositionKeys.every(axis => Number.isInteger(data.position?.[axis]) &&
        data.position[axis] >= 0 && data.position[axis] <= 10)) return;

  const { back, side, leg } = data.position;
  session.latest = { ...data, position: { back, side, leg }, receivedAt: Date.now() };
  shown.back = back * 7;
  shown.tilt = (5 - side) * 4;
  shown.legs = (5 - leg) * 14;

  if (session.pending) {
    if (data.status === 'READY' && data.arduino_connected &&
        matchesPosition(session.latest.position, session.pending.destination)) {
      session.pending = undefined;
      session.feedback = 'Arduino รายงานระดับตรงกับเป้าหมาย';
    } else if (data.status === 'EMERGENCY' || !data.arduino_connected) {
      session.pending = undefined;
      session.feedback = 'ยืนยันผลการขยับไม่ได้ · ตรวจสอบสถานะอุปกรณ์';
    }
  }
  if (session.manualUntil && !isAutomatic(data)) {
    session.manualUntil = undefined;
    session.feedback = 'ESP32 ยืนยันโหมดควบคุมด้วยตนเอง';
  }
  syncLiveControls();
  scheduleDrawing();
}

function disconnectLiveClient(session, message) {
  const client = session.client;
  session.client = undefined;
  session.latest = undefined;
  session.pending = undefined;
  session.manualUntil = undefined;
  clearInterval(session.timer);
  client?.end(true);
  session.phase = message;
  session.feedback = 'ไม่มีข้อมูลตำแหน่งล่าสุดจากอุปกรณ์';
  connectButton.disabled = false;
  syncLiveControls();
}

function tickLiveSession(session) {
  if (session.phase !== 'online' && Date.now() >= session.connectBy) {
    disconnectLiveClient(session, 'หมดเวลารอเชื่อมต่อหรือสมัครรับสถานะ MQTT');
    return;
  }
  if (session.pending && Date.now() >= session.pending.expiresAt) {
    session.pending = undefined;
    session.latest = undefined;
    session.feedback = 'หมดเวลารอผลคำสั่ง · รอสถานะอุปกรณ์รอบถัดไป';
  }
  if (session.manualUntil && Date.now() >= session.manualUntil) {
    session.manualUntil = undefined;
    session.feedback = 'หมดเวลารอ ESP32 ยืนยันโหมดควบคุมด้วยตนเอง';
  }
  if (session.pending || session.manualUntil || !liveStatus()) requestLiveStatus(session);
  syncLiveControls();
}

function requestLiveStatus(session) {
  const now = Date.now();
  if (session.phase !== 'online' || !session.client?.connected ||
      now - (session.statusRequestedAt ?? -Infinity) < statusRequestInterval) return;
  session.statusRequestedAt = now;
  session.client.publish(commandTopic, JSON.stringify({ command: 'STATUS' }), { qos: 0, retain: false });
}

connectionForm.addEventListener('submit', event => {
  event.preventDefault();
  if (liveSession?.client) return;

  let endpoint;
  try {
    endpoint = new URL(brokerUrl.value.trim());
  } catch {
    setText(connectionStatus, 'กรอก URL ของ MQTT WebSocket ให้ถูกต้อง');
    return;
  }
  if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    setText(connectionStatus, 'ใช้ URL แบบ wss:// โดยกรอกชื่อผู้ใช้และรหัสผ่านแยกในช่องด้านล่าง');
    return;
  }
  if (!globalThis.mqtt?.connect) {
    setText(connectionStatus, 'โหลดตัวเชื่อมต่อ MQTT ไม่สำเร็จ');
    return;
  }

  const session = {
    phase: 'กำลังเชื่อมต่อ MQTT',
    connectBy: Date.now() + statusTimeout,
  };
  liveSession = session;
  movements.clear();
  returningFlat = false;
  activeControl = undefined;
  Object.assign(shown, { back: 0, tilt: 0, legs: 0 });
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  updateControlLabels(true);
  syncLiveControls();
  scheduleDrawing();

  let client;
  try {
    client = globalThis.mqtt.connect(endpoint.href, {
      username: brokerUsername.value.trim() || undefined,
      password: brokerPassword.value || undefined,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 0,
      queueQoSZero: false,
    });
  } catch {
    disconnectLiveClient(session, 'เปิดการเชื่อมต่อ MQTT ไม่สำเร็จ');
    return;
  } finally {
    brokerPassword.value = '';
  }

  session.client = client;
  syncLiveControls();
  session.timer = setInterval(() => tickLiveSession(session), 1000);
  const current = () => liveSession === session && session.client === client;
  client.on('error', () => {
    if (current()) disconnectLiveClient(session, 'เชื่อมต่อ MQTT ไม่สำเร็จ · ตรวจสอบ URL และสิทธิ์ของบัญชี');
  });
  client.on('close', () => {
    if (current()) disconnectLiveClient(session, 'การเชื่อมต่อ MQTT สิ้นสุด');
  });
  client.on('connect', () => {
    if (!current()) return;
    session.phase = 'กำลังสมัครรับสถานะ ESP32';
    syncLiveControls();
    client.subscribe(statusTopic, { qos: 0 }, (error, subscriptions) => {
      if (!current()) return;
      if (error || !subscriptions?.some(subscription => subscription.topic === statusTopic && subscription.qos === 0)) {
        disconnectLiveClient(session, 'สมัครรับสถานะ ESP32 ไม่สำเร็จ · ตรวจสอบสิทธิ์ MQTT');
        return;
      }
      session.phase = 'online';
      requestLiveStatus(session);
      syncLiveControls();
    });
  });
  client.on('message', (topic, message, packet) => {
    if (current() && session.phase === 'online') receiveLiveStatus(session, topic, message, packet);
  });
});

disconnectButton.addEventListener('click', () => {
  if (liveSession?.client) disconnectLiveClient(liveSession, 'ตัดการเชื่อมต่อเตียงจริงแล้ว');
});

switchMode.addEventListener('click', () => {
  brokerPassword.value = '';
  movements.clear();
  returningFlat = false;
  for (const axis of axes) {
    shown[axis] = 0;
    target[axis] = 0;
  }
  if (!liveSession) {
    liveSession = { phase: 'ยังไม่ได้เชื่อมต่อเตียงจริง' };
    updateControlLabels(true);
    update(undefined, '', performance.now());
    return;
  }
  if (liveSession.client) disconnectLiveClient(liveSession, 'ตัดการเชื่อมต่อเตียงจริงแล้ว');
  liveSession = undefined;
  canvas.classList.remove('position-unknown');
  takeManualControl.hidden = true;
  updateControlLabels(false);
  setText(connectionStatus, 'กำลังใช้โหมดจำลอง');
  update(undefined, 'เตียงจำลองอยู่ในแนวราบ', performance.now());
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

updateControlLabels(true);
syncControls(performance.now());
drawBed();

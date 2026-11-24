"""
Skeleton Pose Detection ผ่านกล้อง (MediaPipe Pose + Face Mesh + OpenCV)
แบ่งสีตามส่วนของร่างกาย: ศีรษะ, ลำตัว, แขน, เอว, ขา
ปุ่มลัด:  q=ออก  s=บันทึกภาพ  m=กลับซ้าย-ขวา  l=เปิด/ปิดป้ายชื่อ  a=เปิด/ปิดมุมข้อต่อ
"""
import argparse
from contextlib import ExitStack
from pathlib import Path
import sys
import time
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np

from led import LedController, pose_to_led

POSE_POINTS = 33
FACE_POINTS = 478
HAND_POINTS = 21
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

# Wrist (0), thumb (1-4), index (5-8), middle (9-12), ring (13-16), pinky (17-20).
HAND_BONES = [(0, 1), (1, 2), (2, 3), (3, 4),
              (0, 5), (5, 6), (6, 7), (7, 8),
              (0, 9), (9, 10), (10, 11), (11, 12),
              (0, 13), (13, 14), (14, 15), (15, 16),
              (0, 17), (17, 18), (18, 19), (19, 20),
              (5, 9), (9, 13), (13, 17)]

# ---------- สี (BGR) ----------
COLOR = {
    "head":  (0, 255, 255),   # เหลือง
    "torso": (0, 200, 0),     # เขียว
    "arm_l": (255, 100, 0),   # น้ำเงิน
    "arm_r": (0, 100, 255),   # ส้ม
    "waist": (255, 0, 255),   # ม่วงชมพู
    "leg_l": (255, 255, 0),   # ฟ้าอ่อน
    "leg_r": (0, 0, 255),     # แดง
}

# ---------- เส้นเชื่อมกระดูก (ดัชนี landmark ของ MediaPipe) ----------
BONES = {
    "head":  [],
    "torso": [(11, 12), (11, 23), (12, 24)],
    "arm_l": [(11, 13), (13, 15)],
    "arm_r": [(12, 14), (14, 16)],
    "waist": [(23, 24)],
    "leg_l": [(23, 25), (25, 27), (27, 29), (27, 31), (29, 31)],
    "leg_r": [(24, 26), (26, 28), (28, 30), (28, 32), (30, 32)],
}

# จุดสำหรับวาดวงกลม และชื่อป้าย
JOINT_GROUP = {}
for _g, _bones in BONES.items():
    for _a, _b in _bones:
        JOINT_GROUP[_a] = _g
        JOINT_GROUP[_b] = _g

LABELS = {  # ตำแหน่งที่จะแปะชื่อส่วนของร่างกาย (landmark index)
    "HEAD": 0, "TORSO": None, "L-ARM": 13, "R-ARM": 14,
    "WAIST": None, "L-LEG": 25, "R-LEG": 26,
}

# มุมข้อต่อ: (จุดต้น, จุดข้อต่อ, จุดปลาย, ชื่อ)
ANGLES = [
    (11, 13, 15, "L-elbow"), (12, 14, 16, "R-elbow"),
    (23, 25, 27, "L-knee"),  (24, 26, 28, "R-knee"),
]

VIS_TH = 0.5  # ความมั่นใจขั้นต่ำของแต่ละจุด


def calc_angle(a, b, c):
    """มุม (องศา) ที่จุด b จากจุด a-b-c"""
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba, bc = a - b, c - b
    length = np.linalg.norm(ba) * np.linalg.norm(bc)
    if length < 1e-9:
        return None
    cos = np.dot(ba, bc) / length
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def open_camera(index, width, height):
    backends = (cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY) if sys.platform.startswith("win") else (cv2.CAP_ANY,)
    for backend in backends:
        cap = cv2.VideoCapture(index, backend)
        if cap.isOpened():
            break
        cap.release()
    else:
        return cap
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def draw_skeleton(img, lms, show_labels=True, show_angles=False, mirror=False):
    h, w = img.shape[:2]
    pts = {}
    for i, lm in enumerate(lms):
        if i < POSE_POINTS and lm.visibility >= VIS_TH:
            x = (1.0 - lm.x) if mirror else lm.x
            pts[i] = (int(x * w), int(lm.y * h))

    # เส้นกระดูก
    for group, bones in BONES.items():
        for a, b in bones:
            if a in pts and b in pts:
                cv2.line(img, pts[a], pts[b], COLOR[group], 3, cv2.LINE_AA)

    # คอ (กึ่งกลางปาก -> กึ่งกลางไหล่)
    # วงกลมศีรษะ (ประมาณจากระยะหูซ้าย-ขวา)
    # จุดข้อต่อ
    for i, p in pts.items():
        if i in JOINT_GROUP:
            cv2.circle(img, p, 5, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(img, p, 5, COLOR[JOINT_GROUP[i]], 1, cv2.LINE_AA)

    # ป้ายชื่อส่วนต่าง ๆ
    if show_labels:
        def put(text, pos, col):
            cv2.putText(img, text, (pos[0] + 8, pos[1] - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 2, cv2.LINE_AA)

        if all(k in pts for k in (11, 12, 23, 24)):
            c = tuple(np.mean([pts[11], pts[12], pts[23], pts[24]], axis=0).astype(int))
            put("TORSO", c, COLOR["torso"])
        if 13 in pts:
            put("L-ARM", pts[13], COLOR["arm_l"])
        if 14 in pts:
            put("R-ARM", pts[14], COLOR["arm_r"])
        if 23 in pts and 24 in pts:
            c = ((pts[23][0] + pts[24][0]) // 2, (pts[23][1] + pts[24][1]) // 2)
            put("WAIST", c, COLOR["waist"])
        if 25 in pts:
            put("L-LEG", pts[25], COLOR["leg_l"])
        if 26 in pts:
            put("R-LEG", pts[26], COLOR["leg_r"])

    # มุมข้อต่อ
    if show_angles:
        for a, b, c, name in ANGLES:
            if a in pts and b in pts and c in pts:
                ang = calc_angle(pts[a], pts[b], pts[c])
                if ang is not None:
                    cv2.putText(img, f"{ang:.0f}", (pts[b][0] + 10, pts[b][1] + 20),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)


def draw_face_points(img, lms, mirror=False):
    """Draw all landmarks returned by Face Landmarker, including the irises."""
    h, w = img.shape[:2]
    overlay = img.copy()
    for lm in lms:
        x = (1.0 - lm.x) if mirror else lm.x
        x, y = int(x * w), int(lm.y * h)
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(overlay, (x, y), 0, (255, 255, 255), -1)
    cv2.addWeighted(overlay, 0.65, img, 0.35, 0, img)


def draw_hands(img, hands, pose_lms=None, mirror=False):
    """Draw the wrist, palm, and five fingers from each 21-point hand mesh."""
    h, w = img.shape[:2]
    pose_wrists = []
    if pose_lms:
        for index, color in ((15, COLOR["arm_l"]), (16, COLOR["arm_r"])):
            lm = pose_lms[index]
            if lm.visibility >= VIS_TH:
                x = 1.0 - lm.x if mirror else lm.x
                pose_wrists.append(((int(x * w), int(lm.y * h)), color))

    for hand in hands:
        if len(hand) < HAND_POINTS:
            continue
        points = []
        for lm in hand:
            x = 1.0 - lm.x if mirror else lm.x
            points.append((int(x * w), int(lm.y * h)))
        if pose_wrists:
            wrist, color = min(pose_wrists, key=lambda item: np.hypot(
                points[0][0] - item[0][0], points[0][1] - item[0][1]))
            cv2.line(img, wrist, points[0], color, 2, cv2.LINE_AA)
        else:
            color = (255, 255, 255)
        for a, b in HAND_BONES:
            cv2.line(img, points[a], points[b], color, 2, cv2.LINE_AA)
        for point in points:
            cv2.circle(img, point, 3, (255, 255, 255), -1, cv2.LINE_AA)


def draw_legend(img):
    items = [("Head", "head"), ("Torso", "torso"), ("L-Arm", "arm_l"),
             ("R-Arm", "arm_r"), ("Waist", "waist"), ("L-Leg", "leg_l"), ("R-Leg", "leg_r")]
    y = 60
    x = max(10, img.shape[1] - 145)
    for name, key in items:
        cv2.rectangle(img, (x, y - 12), (x + 18, y + 2), COLOR[key], -1)
        cv2.putText(img, name, (x + 25, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 1, cv2.LINE_AA)
        y += 22


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0, help="หมายเลขกล้อง (0 = กล้องในตัว)")
    ap.add_argument("--video", type=str, default=None, help="ใช้ไฟล์วิดีโอแทนกล้อง")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--pose-model", type=Path, default=MODEL_DIR / "pose_landmarker_lite.task")
    ap.add_argument("--face-model", type=Path, default=MODEL_DIR / "face_landmarker.task")
    ap.add_argument("--hand-model", type=Path, default=MODEL_DIR / "hand_landmarker.task")
    ap.add_argument("--no-mirror", action="store_true", help="ไม่กลับภาพซ้าย-ขวา")
    ap.add_argument("--led-port", default="COM3", help="พอร์ต ESP32 สำหรับโมดูล LED (ค่าเริ่มต้น COM3)")
    ap.add_argument("--no-led", action="store_true", help="รันเฉพาะกล้องโดยไม่เชื่อมโมดูล LED")
    args = ap.parse_args()

    for model in (args.pose_model, args.face_model):
        if not model.is_file():
            ap.error(f"ไม่พบโมเดล: {model}")

    if not args.hand_model.is_file():
        print(f"Downloading Hand Landmarker model to {args.hand_model}...")
        args.hand_model.parent.mkdir(parents=True, exist_ok=True)
        partial_model = args.hand_model.with_suffix(".task.part")
        try:
            urlretrieve(HAND_MODEL_URL, partial_model)
            partial_model.replace(args.hand_model)
        except OSError as exc:
            partial_model.unlink(missing_ok=True)
            ap.error(f"Cannot download hand model: {exc}. Download {HAND_MODEL_URL} to {args.hand_model}")

    cap = cv2.VideoCapture(args.video) if args.video else open_camera(args.camera, args.width, args.height)
    if not cap.isOpened():
        print("❌ เปิดกล้องไม่ได้ - ตรวจสอบสิทธิ์กล้อง หรือลอง --camera 1")
        sys.exit(1)

    mirror = not args.no_mirror and not args.video
    show_labels, show_angles = True, False
    prev = time.time()
    fps = 0.0

    with ExitStack() as models:
        models.callback(cv2.destroyAllWindows)
        models.callback(cap.release)
        led = None
        if not args.no_led:
            try:
                led = LedController(args.led_port)
                models.callback(led.close)
                print(f"เชื่อมต่อ LED ที่ {args.led_port}")
            except (ImportError, OSError) as exc:
                print(f"เชื่อมต่อ LED ไม่ได้: {exc}")
        pose = models.enter_context(mp.tasks.vision.PoseLandmarker.create_from_options(
            mp.tasks.vision.PoseLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(args.pose_model)),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_poses=1,
            )
        ))
        face_mesh = models.enter_context(mp.tasks.vision.FaceLandmarker.create_from_options(
            mp.tasks.vision.FaceLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(args.face_model)),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_faces=1,
            )
        ))
        hand_mesh = models.enter_context(mp.tasks.vision.HandLandmarker.create_from_options(
            mp.tasks.vision.HandLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(args.hand_model)),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_hands=2,
            )
        ))
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = time.monotonic_ns() // 1_000_000
            pose_result = pose.detect_for_video(image, timestamp_ms)
            face_result = face_mesh.detect_for_video(image, timestamp_ms)
            hand_result = hand_mesh.detect_for_video(image, timestamp_ms)
            display = cv2.flip(frame, 1) if mirror else frame

            led_state = pose_to_led(pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None)
            if led is not None:
                try:
                    led.send(led_state)
                except OSError as exc:
                    print(f"ส่งคำสั่ง LED ไม่ได้: {exc}")
                    led = None

            if pose_result.pose_landmarks:
                draw_skeleton(display, pose_result.pose_landmarks[0], show_labels, show_angles, mirror)
            else:
                cv2.putText(display, "No person detected", (10, 90),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            if face_result.face_landmarks:
                draw_face_points(display, face_result.face_landmarks[0], mirror)
            draw_hands(display, hand_result.hand_landmarks,
                       pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None, mirror)

            pose_count = min(len(pose_result.pose_landmarks[0]), POSE_POINTS) if pose_result.pose_landmarks else 0
            face_count = len(face_result.face_landmarks[0]) if face_result.face_landmarks else 0
            hand_count = len(hand_result.hand_landmarks)
            cv2.putText(display, f"Pose: {pose_count}/{POSE_POINTS}  Face: {face_count}/{FACE_POINTS}  Hands: {hand_count}/2",
                        (10, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(display, f"LED: {led_state.upper()}", (10, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - prev, 1e-6))
            prev = now
            cv2.putText(display, f"FPS: {fps:.1f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2, cv2.LINE_AA)
            draw_legend(display)

            cv2.imshow("Skeleton Pose Detection  (q=quit)", display)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            elif key == ord("s"):
                name = time.strftime("pose_%Y%m%d_%H%M%S.png")
                if cv2.imwrite(name, display):
                    print("บันทึกภาพ:", name)
                else:
                    print("บันทึกภาพไม่สำเร็จ:", name)
            elif key == ord("m"):
                mirror = not mirror
            elif key == ord("l"):
                show_labels = not show_labels
            elif key == ord("a"):
                show_angles = not show_angles

if __name__ == "__main__":
    main()

"""
Skeleton Pose Detection ผ่านกล้อง (MediaPipe Pose + OpenCV)
แบ่งสีตามส่วนของร่างกาย: ศีรษะ, ลำตัว, แขน, เอว, ขา
ปุ่มลัด:  q=ออก  s=บันทึกภาพ  m=กลับซ้าย-ขวา  l=เปิด/ปิดป้ายชื่อ  a=เปิด/ปิดมุมข้อต่อ
"""
import argparse
import sys
import time

import cv2
import mediapipe as mp
import numpy as np

mp_pose = mp.solutions.pose

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
    "head":  [(0, 1), (1, 2), (2, 3), (3, 7), (0, 4), (4, 5), (5, 6), (6, 8), (9, 10)],
    "torso": [(11, 12), (11, 23), (12, 24)],
    "arm_l": [(11, 13), (13, 15), (15, 17), (15, 19), (15, 21)],
    "arm_r": [(12, 14), (14, 16), (16, 18), (16, 20), (16, 22)],
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
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def open_camera(index, width, height):
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)  # เร็วและเสถียรกว่าบน Windows
    else:
        cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def draw_skeleton(img, lms, show_labels=True, show_angles=False):
    h, w = img.shape[:2]
    pts = {}
    for i, lm in enumerate(lms):
        if lm.visibility >= VIS_TH:
            pts[i] = (int(lm.x * w), int(lm.y * h))

    # เส้นกระดูก
    for group, bones in BONES.items():
        for a, b in bones:
            if a in pts and b in pts:
                cv2.line(img, pts[a], pts[b], COLOR[group], 3, cv2.LINE_AA)

    # คอ (กึ่งกลางปาก -> กึ่งกลางไหล่)
    if all(k in pts for k in (9, 10, 11, 12)):
        mouth = ((pts[9][0] + pts[10][0]) // 2, (pts[9][1] + pts[10][1]) // 2)
        neck = ((pts[11][0] + pts[12][0]) // 2, (pts[11][1] + pts[12][1]) // 2)
        cv2.line(img, mouth, neck, COLOR["head"], 3, cv2.LINE_AA)

    # วงกลมศีรษะ (ประมาณจากระยะหูซ้าย-ขวา)
    if 7 in pts and 8 in pts and 0 in pts:
        cx = (pts[7][0] + pts[8][0]) // 2
        cy = (pts[7][1] + pts[8][1]) // 2
        r = int(np.hypot(pts[7][0] - pts[8][0], pts[7][1] - pts[8][1]) * 0.85)
        cv2.circle(img, (cx, cy), max(r, 10), COLOR["head"], 2, cv2.LINE_AA)

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

        if 0 in pts:
            put("HEAD", pts[0], COLOR["head"])
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
                cv2.putText(img, f"{ang:.0f}", (pts[b][0] + 10, pts[b][1] + 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)


def draw_legend(img):
    items = [("Head", "head"), ("Torso", "torso"), ("L-Arm", "arm_l"),
             ("R-Arm", "arm_r"), ("Waist", "waist"), ("L-Leg", "leg_l"), ("R-Leg", "leg_r")]
    y = 60
    for name, key in items:
        cv2.rectangle(img, (10, y - 12), (28, y + 2), COLOR[key], -1)
        cv2.putText(img, name, (35, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 1, cv2.LINE_AA)
        y += 22


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0, help="หมายเลขกล้อง (0 = กล้องในตัว)")
    ap.add_argument("--video", type=str, default=None, help="ใช้ไฟล์วิดีโอแทนกล้อง")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--complexity", type=int, default=1, choices=[0, 1, 2],
                    help="0=เร็วสุด, 1=สมดุล, 2=แม่นสุด/ช้าสุด")
    ap.add_argument("--no-mirror", action="store_true", help="ไม่กลับภาพซ้าย-ขวา")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video) if args.video else open_camera(args.camera, args.width, args.height)
    if not cap.isOpened():
        print("❌ เปิดกล้องไม่ได้ - ตรวจสอบสิทธิ์กล้อง หรือลอง --camera 1")
        sys.exit(1)

    mirror = not args.no_mirror and not args.video
    show_labels, show_angles = True, False
    prev = time.time()
    fps = 0.0

    with mp_pose.Pose(model_complexity=args.complexity,
                      smooth_landmarks=True,
                      min_detection_confidence=0.5,
                      min_tracking_confidence=0.5) as pose:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if mirror:
                frame = cv2.flip(frame, 1)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            result = pose.process(rgb)

            if result.pose_landmarks:
                draw_skeleton(frame, result.pose_landmarks.landmark, show_labels, show_angles)
            else:
                cv2.putText(frame, "No person detected", (10, 90),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - prev, 1e-6))
            prev = now
            cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2, cv2.LINE_AA)
            draw_legend(frame)

            cv2.imshow("Skeleton Pose Detection  (q=quit)", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            elif key == ord("s"):
                name = time.strftime("pose_%Y%m%d_%H%M%S.png")
                cv2.imwrite(name, frame)
                print("บันทึกภาพ:", name)
            elif key == ord("m"):
                mirror = not mirror
            elif key == ord("l"):
                show_labels = not show_labels
            elif key == ord("a"):
                show_angles = not show_angles

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

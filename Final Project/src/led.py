"""Map MediaPipe pose landmarks to an RYG LED command over serial."""

import time


def pose_to_led(landmarks):
    """Return red, yellow, green, or off for raised wrists above shoulders."""
    if not landmarks or len(landmarks) < 33:
        return "off"

    def raised(shoulder_index, wrist_index):
        shoulder = landmarks[shoulder_index]
        wrist = landmarks[wrist_index]
        if min(getattr(shoulder, "visibility", 1.0),
               getattr(wrist, "visibility", 1.0),
               getattr(shoulder, "presence", 1.0),
               getattr(wrist, "presence", 1.0)) < 0.5:
            return False
        return wrist.y < shoulder.y - 0.05

    left = raised(11, 15)
    right = raised(12, 16)
    if left and right:
        return "red"
    if left:
        return "green"
    if right:
        return "yellow"
    return "off"


class LedController:
    def __init__(self, port):
        import serial

        self.board = serial.Serial(port, 115200, timeout=0, write_timeout=1)
        self.last_state = None
        self.last_sent = 0.0
        # Opening the port resets some ESP32 boards.
        time.sleep(2)
        self.board.reset_input_buffer()

    def send(self, state):
        now = time.monotonic()
        if state == self.last_state and now - self.last_sent < 1.0:
            return
        self.board.reset_input_buffer()
        self.board.write(f"led {state}\n".encode("ascii"))
        self.last_state = state
        self.last_sent = now

    def close(self):
        try:
            self.board.write(b"led off\n")
        except OSError:
            pass
        finally:
            self.board.close()

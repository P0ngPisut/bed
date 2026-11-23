"""Show ESP32-S3 load-cell readings and save them as CSV."""

import argparse
import csv
import re
from datetime import datetime
from pathlib import Path
from threading import Thread

import serial


WEIGHT = re.compile(
    r"Weight: (?:(-?\d+) g|(-?\d+) Kg(?: (\d+) g)?) "
    r"\| band \+/-5g: (-?\d+)\.\.(-?\d+) g \| raw: (-?\d+)"
)
RAW = re.compile(r"Uncalibrated \| net counts: ([+-]?\d+) \| raw: ([+-]?\d+)")
DEFAULT_LOG = Path(__file__).resolve().parents[1] / "logs" / "loadcell_g_5g.csv"


def send_commands(board):
    while True:
        try:
            command = input().strip()
        except EOFError:
            return
        if command:
            try:
                board.write((command + "\n").encode("utf-8"))
            except serial.SerialException:
                return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM3", help="ESP32-S3 serial port")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    args = parser.parse_args()

    args.log.parent.mkdir(parents=True, exist_ok=True)
    new_file = not args.log.exists() or args.log.stat().st_size == 0
    try:
        with serial.Serial(args.port, args.baud, timeout=1) as board, args.log.open(
            "a", newline="", encoding="utf-8"
        ) as output:
            writer = csv.writer(output)
            if new_file:
                writer.writerow(
                    ["timestamp", "weight_g", "band_min_g", "band_max_g", "net_counts", "raw", "message"]
                )
                output.flush()

            print(f"Reading {args.port} at {args.baud} baud. Logging to {args.log}")
            print("Type tare (empty cell), cal <known kg>, or check <known kg>, then Enter.")
            print("Press Ctrl+C to stop. Close other Serial Monitors first.")
            Thread(target=send_commands, args=(board,), daemon=True).start()
            while True:
                line = board.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
                weight = WEIGHT.fullmatch(line)
                raw = RAW.fullmatch(line)
                if weight:
                    if weight.group(1) is not None:
                        weight_g = int(weight.group(1))
                    else:
                        kg = int(weight.group(2))
                        remainder_g = int(weight.group(3) or 0)
                        weight_g = (abs(kg) * 1000 + remainder_g) * (-1 if kg < 0 else 1)
                    row = [timestamp, weight_g, weight.group(4), weight.group(5), "", weight.group(6), ""]
                elif raw:
                    row = [timestamp, "", "", "", raw.group(1), raw.group(2), "uncalibrated"]
                else:
                    row = [timestamp, "", "", "", "", "", line]
                writer.writerow(row)
                output.flush()
                print(f"{timestamp} | {line}", flush=True)
    except KeyboardInterrupt:
        print("\nLogging stopped.")
    except serial.SerialException as exc:
        parser.exit(1, f"Cannot open/read {args.port}: {exc}\n")


if __name__ == "__main__":
    main()

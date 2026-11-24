"""Show ESP32-S3 load-cell readings and save them as CSV."""

import argparse
import csv
import re
from datetime import datetime
from pathlib import Path
from threading import Thread

import serial


WEIGHT = re.compile(r"(-?\d+) g|(-?\d+) Kg(?: (\d+) g)?")
CELL_LINE = re.compile(r"Cell1: (.*?) \| Cell2: (.*)")
DEFAULT_LOG = Path(__file__).resolve().parents[1] / "logs" / "loadcell_cells.csv"


def grams(text):
    match = WEIGHT.fullmatch(text)
    if not match:
        return ""
    if match.group(1) is not None:
        return int(match.group(1))
    kg = int(match.group(2))
    remainder_g = int(match.group(3) or 0)
    return (abs(kg) * 1000 + remainder_g) * (-1 if kg < 0 else 1)


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
                    ["timestamp", "cell1_g", "cell2_g", "message"]
                )
                output.flush()

            print(f"Reading {args.port} at {args.baud} baud. Logging to {args.log}")
            print("Type tare 1/2, cal 1/2 <known kg>, or check 1/2 <known kg>, then Enter.")
            print("Press Ctrl+C to stop. Close other Serial Monitors first.")
            Thread(target=send_commands, args=(board,), daemon=True).start()
            while True:
                line = board.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
                cell_line = CELL_LINE.fullmatch(line)
                if cell_line:
                    cell1, cell2 = cell_line.groups()
                    cell1_g, cell2_g = grams(cell1), grams(cell2)
                    message = "" if cell1_g != "" and cell2_g != "" else f"Cell1: {cell1}; Cell2: {cell2}"
                    row = [timestamp, cell1_g, cell2_g, message]
                else:
                    row = [timestamp, "", "", line]
                writer.writerow(row)
                output.flush()
                print(f"{timestamp} | {line}", flush=True)
    except KeyboardInterrupt:
        print("\nLogging stopped.")
    except serial.SerialException as exc:
        parser.exit(1, f"Cannot open/read {args.port}: {exc}\n")


if __name__ == "__main__":
    main()

"""Exercise the Native Messaging framing and batch worker outside the browser."""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "server" / "native-host.exe"


def read_exact(stream, count: int) -> bytes:
    output = bytearray()
    while len(output) < count:
        chunk = stream.read(count - len(output))
        if not chunk:
            raise EOFError("The native host closed its output early.")
        output.extend(chunk)
    return bytes(output)


def send_message(process: subprocess.Popen, message: dict) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    process.stdin.write(struct.pack("<I", len(payload)))
    process.stdin.write(payload)
    process.stdin.flush()


def read_message(process: subprocess.Popen) -> dict:
    size = struct.unpack("<I", read_exact(process.stdout, 4))[0]
    return json.loads(read_exact(process.stdout, size))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_url")
    parser.add_argument("--source-kind", choices=("direct", "youtube"), default="youtube")
    parser.add_argument("--language", default="en")
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    process = subprocess.Popen(
        [str(HOST)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    job_id = f"smoke-{uuid.uuid4()}"
    send_message(process, {
        "command": "batch_transcribe",
        "jobId": job_id,
        "sourceKind": args.source_kind,
        "sourceUrl": args.source_url,
        "headers": {},
        "language": args.language,
        "model": args.model,
    })

    try:
        while True:
            message = read_message(process)
            print(json.dumps(message, ensure_ascii=False))
            if message.get("state") in {"batch_complete", "batch_error"}:
                return 0 if message["state"] == "batch_complete" else 1
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        error_output = process.stderr.read().decode("utf-8", errors="replace").strip()
        if error_output:
            print(error_output, file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())

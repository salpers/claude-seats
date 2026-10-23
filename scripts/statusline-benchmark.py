"""Measure cold statuslines with a representative legacy workload in a temp tree."""

import argparse
import json
import os
from pathlib import Path
import platform
import shlex
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
NODE = subprocess.check_output(["node", "-p", "process.execPath"], text=True).strip()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--legacy-command", help="Explicit prefix command to measure instead of the isolated workload fixture")
parser.add_argument("--samples", type=int, default=20)
args = parser.parse_args()
if args.samples < 1:
    parser.error("--samples must be positive")
LIMIT_MS = 100


def seed(home):
    repo = home / "repo"
    subprocess.run(["git", "init", "--quiet", "--initial-branch=main", str(repo)], check=True)
    config = home / ".claude-dev3"
    config.mkdir()
    (config / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "fixture@example.invalid"}}))
    (home / "transcript.jsonl").write_text(
        (json.dumps({"context_percent": 12}) + "\n") * 1000
    )


def invoke(command, payload, env, home):
    started = time.perf_counter_ns()
    result = subprocess.run(["/bin/sh", "-c", command], input=json.dumps(payload),
                            capture_output=True, text=True, env=env, cwd=home,
                            timeout=5, check=True)
    elapsed = (time.perf_counter_ns() - started) / 1_000_000
    if result.stderr:
        raise RuntimeError("Unexpected statusline stderr")
    return elapsed, result.stdout


def report(label, times):
    print(f"{label}: n={len(times)}, min={min(times):.2f} ms, "
          f"median={statistics.median(times):.2f} ms, max={max(times):.2f} ms")


def benchmark(home, mode):
    state = home / "state"
    state.mkdir(exist_ok=True)
    cache = state / "usage-dev3.json"
    cache.unlink(missing_ok=True)
    if mode == "cache":
        cache.write_text(json.dumps({
            "fetchedAt": 0,
            "usage": {
                "fiveHour": {"utilization": 10, "resetAt": "2026-09-18T15:20:00.000Z"},
                "sevenDay": {"utilization": 1, "resetAt": "2026-09-25T11:00:00.000Z"},
            },
        }))
    payload = {
        "model": {"display_name": "Sonnet"},
        "cwd": str(home / "repo"),
        "workspace": {"current_dir": str(home / "repo")},
        "transcript_path": str(home / "transcript.jsonl"),
    }
    if mode == "live":
        payload["rate_limits"] = {
            "five_hour": {"used_percentage": 10, "resets_at": 1789744800},
            "seven_day": {"used_percentage": 1, "resets_at": 1790334000},
        }
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(home),
        "CLAUDE_SEATS_HOME": str(home),
        "CLAUDE_SEATS_STATE_DIR": str(state),
        "CLAUDE_CONFIG_DIR": str(home / ".claude-dev3"),
        "TZ": "Europe/Berlin",
    }
    legacy = args.legacy_command or shlex.join([
        "/bin/bash", str(ROOT / "tests/fixtures/statusline-workload.sh"),
    ])
    command = shlex.join([NODE, str(ROOT / "src/statusline-cli.mjs"), "--legacy-command", legacy])
    suffix = "dev3 · 5h "
    suffix += "— · 7d —\n" if mode == "missing" else "10% ↻17:20 · 7d 1% ↻Fri 13:00\n"
    expected = "Sonnet | repo | git:main | ctx 12% | " + suffix
    times, baseline = [], []
    for _ in range(args.samples):
        elapsed, _ = invoke(legacy, payload, env, home)
        baseline.append(elapsed)
        elapsed, output = invoke(command, payload, env, home)
        times.append(elapsed)
        if (not args.legacy_command and output != expected) or not output.endswith(suffix):
            raise RuntimeError("Unexpected statusline output")
    report(f"{mode} legacy alone", baseline)
    report(f"{mode} complete adapter", times)
    return max(times) < LIMIT_MS


print(f"{platform.system()} {platform.machine()}, Python {platform.python_version()}")
print(subprocess.check_output(["node", "--version"], text=True).strip())
print("Workload: " + ("explicit command (isolated HOME/cwd)" if args.legacy_command else
                     "shell + cat + Python + git + 1000-line transcript + fixture identity"))
with tempfile.TemporaryDirectory(prefix="claude-seats-statusline-bench-") as directory:
    home = Path(directory)
    seed(home)
    results = [benchmark(home, mode) for mode in ("live", "cache", "missing")]
print("100 ms sample target: " + ("PASS" if all(results) else "FAIL (includes command work and host scheduling)"))
sys.exit(0 if all(results) else 1)

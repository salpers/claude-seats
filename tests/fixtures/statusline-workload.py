"""Representative fixture: git lookup, transcript read, and optional identity/usage."""

import json
import os
from pathlib import Path
import subprocess
import sys

payload = json.loads(sys.argv[1])
cwd = Path(payload["workspace"]["current_dir"])
branch = subprocess.check_output(
    ["git", "-C", str(cwd), "symbolic-ref", "--short", "HEAD"], text=True
).strip()
transcript = Path(payload["transcript_path"]).read_text().splitlines()
context = json.loads(transcript[-1])["context_percent"]
segments = [payload["model"]["display_name"], cwd.name, f"git:{branch}", f"ctx {context}%"]
if payload.get("rate_limits"):
    segments.extend(["sess 10%", "wk 1%"])
config = Path(os.environ["CLAUDE_CONFIG_DIR"]) / ".claude.json"
account = json.loads(config.read_text()).get("oauthAccount", {})
if account.get("emailAddress"):
    segments.append(account["emailAddress"])
print(" | ".join(segments))

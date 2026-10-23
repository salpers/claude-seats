"""Synthetic legacy renderer: the real legacy script is not in the checkout."""

import json
import sys

data = json.load(sys.stdin)
prefix = " | ".join(data.get("fixture_prefix", ["Sonnet", "~/repo", "main*", "ctx 12%"]))
segments = [prefix]
windows = data.get("rate_limits") or {}
for window, label in (("five_hour", "sess"), ("seven_day", "wk")):
    value = windows.get(window)
    if isinstance(value, dict) and isinstance(value.get("used_percentage"), (int, float)):
        segments.append(f"{label} {value['used_percentage']}%")
if data.get("fixture_email", True):
    account = data.get("fixture_account", {"emailAddress": "person@example.invalid"})
    identity = account.get("emailAddress") or account.get("displayName")
    if identity:
        segments.append(identity)
print(" | ".join(segments))

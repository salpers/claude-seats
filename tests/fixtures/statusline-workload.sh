#!/bin/bash
# Match the legacy shell -> cat -> Python process shape without touching real seats.
input="$(cat)"
exec python3 "${BASH_SOURCE[0]%/*}/statusline-workload.py" "$input"

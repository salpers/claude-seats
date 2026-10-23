# Design — claude-seats

Settled 2026-09-18 by grilling. Numbers refer to the questions asked there.
Runtime requires Node >=24; development/verification remains pinned to Node 24.

## Goal
One shell entrypoint (`cc`, later shadowing `claude`) that launches each new Claude Code
session on the seat with the most headroom, spreads concurrent sessions across all four
seats, and lets a session be handed to another seat when one runs dry.

## Seats
| seat | config dir | keychain slot |
|---|---|---|
| `main` | bare `~/.claude` — launched with `CLAUDE_CONFIG_DIR` **unset** | `Claude Code-credentials` |
| `dev`, `dev2`, `dev3` | `~/.claude-<seat>` | `Claude Code-credentials-<sha256(dir)[:8]>` |

`~/.claude-api` is excluded. The table shows the default seats; `~/.claude-shared/seats.json`
(a JSON array of names) replaces them, and `main` always means bare `~/.claude`. Identity (`.claude.json`, keychain) stays per seat; session
state (`projects/`, `history.jsonl`, `file-history/`, `shell-snapshots/`, `tasks/`) is
shared via `~/.claude-shared/`, config via the `~/.claude` hub. (Q2/Q11: option A —
no new dir, no re-login; the special case is one line.)

## Routing (Q7a)
1. Usage per seat: `GET https://api.anthropic.com/api/oauth/usage`,
   `Authorization: Bearer <seat token>`, `anthropic-beta: oauth-2025-04-20`.
   Response carries `five_hour` / `seven_day` `{utilization, resets_at}` plus obfuscated
   internal fields — client-internal endpoint, may change silently. Cached 60 s per seat
   in `~/.claude-shared/_seats/`. Endpoint overrides require HTTPS, except HTTP
   on loopback `127.0.0.1`, `::1` or `localhost` for isolated fixtures.
2. Exclude exhausted seats (5h **or** 7d ≥ 100%). None left → **refuse** (Q14a): print the
   table with reset clocks and mention `cc @seat`. Revisit once metered usage is back.
3. Order: fewest live sessions + claims → below 90% on 5h before ≥ 90% → lowest 7d →
   registry order. A seat with one known, non-exhausted window stays rankable:
   unknown 5h ranks with ≥ 90%, unknown 7d ranks after every known 7d value.
   Only two unknown windows require fallback. Live sessions are distinct live PIDs
   parsed from `<dir>/sessions/<pid>.<sha256>.key` filenames (64 lowercase hex
   characters); temporary `.key.tmp.<hex>` entries are ignored. Key contents are
   not read. A fresh session's first turn is the expensive one.
4. Endpoint down: last-good cache ≤ 10 min; else probe candidate seats with a minimal
   `-p` call, parse `resets HH:MM` into a cooldown, round-robin the rest.
5. Every decision appends one line to `~/.claude-shared/_seats/decisions.log`.

## Before every launch (Q8b)
Union-sync `projects.*` across the four `.claude.json`s: `hasTrustDialogAccepted`,
`mcpServers`, `allowedTools`, `enabledMcpjsonServers`. Seat-local value wins on a same-key
conflict. Atomic write; no other keys touched. No shared hot file.

## CLI
- `cc [claude args…]` — auto-route, then run the real binary in a subshell with args passed through.
- `cc @<seat> …` — manual override. If the routing lock stays busy, launch without a
  claim and log the bypass; an audit write failure still refuses the launch.
  `cc @` — seat table (5h / 7d / clocks / live sessions).
- `cc -r` — best seat + Claude's own interactive `--resume` picker (spans all seats via the
  shared store). `cc -r <id>` — explicit id. (Q15a)
- Shadowing `claude` itself is deferred until `cc` proves out (Q10).
- The sourced zsh `cc` function shadows the system C compiler (`/usr/bin/cc`).
  Use `command cc` for compiler invocations; compiler arguments otherwise pass
  through to Claude. Ordinary scripts and Makefiles do not inherit the function.
  A terminal without the shim sourced resolves `cc doctor` to the compiler.

## Hand-off (Q9b)
`autoContinueAtUsageLimit: false` in the shared settings so a dry seat fails fast; quit,
then `cc -r`.
The router enforces this in the `.claude/settings.json` hub before every launch,
including new sessions: setting it only during resume would leave the original dry
session parked until reset. Other seats retain their settings symlinks to the hub.
The atomic edit preserves unrelated settings and permissions, skips an already-false
value, and refuses launch if it cannot establish the setting safely.
`-r` becomes `--resume` after the optional seat selector; the shared `projects/` store
supplies cross-seat history to Claude's picker and explicit-ID resume. Decisions add
`resume: true` and a `sessionId` for an explicit UUID, never free-text search terms
or prompt arguments.

## Statusline (Q16)
`… | dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00`. Seat from `CLAUDE_CONFIG_DIR`
(`main` when unset). Usage from Claude's stdin `rate_limits`; before the first response,
fall back to the router cache. The trailing account identity (email or fallback
display name recognized after a context boundary) is dropped; the
model/cwd/git/context prefix keeps its original bytes. Unrecognized prefix shapes
pass through unchanged; only recognized usage/identity tails are stripped.

## Testability
Five environment seams (`CLAUDE_SEATS_HOME`, `_STATE_DIR`, `_USAGE_URL`, `_CLAUDE_BIN`,
`_KEYCHAIN_DIR`, see `AGENTS.md`) let the whole CLI run against a temp tree with a fake
`claude` binary and fixture credentials — the e2e suite is built on them, and the real seats
are only touched by a small explicit smoke set.

## Concurrency
Two `cc` invocations in the same second must not pick the same seat: the chooser writes a
short-lived claim (≈10 s) to the state dir and counts other seats' claims as live sessions.
Fallback probes run outside the reservation lock. Before choosing, re-read live counts,
claims, cooldowns and the round-robin cursor under the lock; newer cooldowns win over
in-flight probe results. Abandoned locks older than 20 s recover automatically; owner
markers protect live processes and concurrent reclaimers. Manual overrides retain the
audited bypass after a 2 s lock wait.

Fallback probe environments exclude inherited Anthropic auth/endpoint variables,
OAuth token overrides and Bedrock/Vertex/Foundry provider selectors. `cc doctor` and
every automatic/manual launch warn about these overrides by name only before
launching: real sessions still inherit them, so they must be
unset for routing measurements to match the launched seat's OAuth identity.

## Known limits, accepted
- Session-granular only: subagents and `--bg` inherit the parent seat (Q1a).
- Shell launches only; IDE/cloud launches bypass the router (Q6a).
- Usage endpoint is unofficial; the fallback path exists for that.

## Out of scope this round
Metered-usage-aware routing, `cc -rr` auto-resume without picker, shadowing `claude`.

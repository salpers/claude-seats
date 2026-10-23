# claude-seats — full reference

This reference uses the default seats `main`, `dev`, `dev2` and `dev3`. Set other seats
in `<seat-home>/.claude-shared/seats.json` (see the README).

One shell entrypoint (`cc`) for Claude Code that launches every new session on the
seat with the most headroom, spreads concurrent sessions across all seats, and hands a
session over to another seat when one runs dry.

Personal tooling — it reads this machine's keychain. Not org-scoped.

- Design: `docs/DESIGN.md` (decisions from the 2026-09-18 grilling session)
- Runtime: TypeScript on Node 24+ (type-stripping, no build step), `node --test`

## Install

Keep this checkout in a permanent location. With Node 24 or newer and Claude Code
on `PATH`, run once in zsh:

```zsh
source /path/to/claude-seats/bin/cc.zsh
cc install
```

Then add this single line to `.zshrc`, after your Node/mise setup:

```zsh
source "${CLAUDE_SEATS_HOME:-$HOME}/.claude-shared/bin/cc.zsh"
```

Open a new terminal and run `cc doctor`, then `cc @`. Runtime needs no dependency
installation or build. The shared `bin/cc.zsh` is a symlink to this checkout;
keep the checkout and Node installation in place. `cc` remains a shell function,
and the real `claude` command stays available.

The sourced `cc` function shadows `/usr/bin/cc`, the POSIX C compiler, in interactive
zsh. Use `command cc -o out file.c` (or `/usr/bin/cc`) to compile C. Plain
`cc -o out file.c` forwards those arguments to Claude through the seat router.
Shell functions are not exported, so ordinary scripts and Makefiles are unaffected.
In a terminal that has not sourced the shim, `cc doctor` invokes the compiler and
may report clang errors about a missing `doctor` file. Source the checkout's shim
as above, or open a new terminal after adding the `.zshrc` line.

Real-home setup requires both explicit steps above: `cc install` creates the shared
bin link, and you add the source line to `.zshrc`. Automated verification installs
only into disposable fixture homes.

`cc install` is idempotent. It creates missing seat directories and shared-store
entries, links the five session entries below from each seat, and links
`dev`/`dev2`/`dev3` settings to the `.claude` hub. It wires the statusline, disables
waiting at usage limits, and creates or secures the router state directory with
mode `0700`. Existing shared transcripts, seat identities and unrelated settings
are preserved. It neither reads credentials nor logs in, and does not edit `.zshrc`.

| Entry in each seat | Target |
|---|---|
| `projects/`, `file-history/`, `shell-snapshots/`, `tasks/` | Same name under `<seat-home>/.claude-shared/` |
| `history.jsonl` | `<seat-home>/.claude-shared/history.jsonl` |
| `settings.json` in `dev`, `dev2`, `dev3` | `<seat-home>/.claude/settings.json` |

Existing unshared files/directories or links to the wrong target cause a specific
error before installation changes anything. Correct links directly to missing
managed targets are preserved: the installer recreates empty shared entries or
generates hub settings. Deleted content must be restored from a backup. Other
dangling links are refused. The installer does not merge or replace personal data.
If converting an unshared setup, back it up and reconcile its session data into the
shared store and config into the hub first; keep `.claude.json` and credentials
seat-local. Correct relative symlinks are accepted. An I/O failure
during installation can leave newly created entries; fix the reported permissions
and rerun `cc install`. `.claude-api` is excluded throughout.

## Doctor

`cc doctor` exits 0 for a healthy setup and 1 with specific diagnostics otherwise.
The JavaScript entrypoint checks Node >=24 before loading TypeScript; an older
version reports the version found and asks you to put Node 24 or newer on PATH.
When no `node` executable is on PATH, the shell shim gives the same recovery step
and exits 1 before invoking JavaScript.
Doctor then checks the four config directories, every session-store and settings
symlink, the installed shim, per-seat keychain slot presence, private readable and
writable state-directory permissions, statusline wiring to this checkout and an executable saved Node path,
and `autoContinueAtUsageLimit: false`. It reports all detected problems in one run.
It does not change files, request usage, execute statusline commands or launch Claude.
Keychain checks inspect presence only, never credential contents; presence does not
guarantee a valid login. A missing slot names the seat and suggests its login command.
Doctor also reports inherited auth/provider overrides by variable name only and
exits 1 until they are unset. These can make the launched Claude session use a
different account or provider than the seat whose headroom the router measured.

After a missing link, rerun `cc install`; existing conflicting data must be reconciled
first. For invalid hub `.claude/settings.json`, first repair it to a valid JSON object
without duplicate top-level keys; repair or remove an invalid `statusLine` field.
For a symlink, wrong file type, unreadable file or invalid UTF-8, restore a readable,
writable regular UTF-8 settings file at the hub path, preserving your settings and
any symlink target. Then rerun `cc install`. Doctor names these prerequisites;
the installer refuses to replace unsafe settings automatically.
For a missing installed shim, source the checkout's `bin/cc.zsh` directly to
run `cc doctor` or `cc install`. Use the five environment overrides below for an
isolated fixture setup; installation and doctor honor the same home/state overrides.

## Launching and selecting seats

```zsh
cc
cc -r
cc -r <session-id>
cc @dev -r
cc @main
cc @
cc doctor
```

Plain `cc [claude args…]` automatically selects a seat. Seats at 100% or more on
either usage window are excluded. Among seats with known headroom, the order is:
fewest live sessions + claims → below 90% on 5h before ≥ 90% → lowest 7d →
registry order (`main`, `dev`, `dev2`, `dev3`). Each step breaks ties from the
preceding step. One unknown window does not force fallback: unknown 5h ranks
with ≥ 90%, and unknown 7d ranks after known weekly values. Known exhaustion
still excludes a seat; only two unknown windows make its usage unavailable.
Immediately before launching, `cc` prints one line such as `cc: using dev2` to stderr,
leaving Claude's stdout available for piping.

If all four seats are exhausted, `cc` prints the seat table with reset clocks and
a `cc @<seat>` override hint to stderr, exits 3, and does not start Claude or sync
project settings. Endpoint failures use last-good numbers up to 10 minutes old,
with a stderr notice such as `cc: main: (usage cached 5m ago)`.

When no seat has usable healthy numbers outside an active cooldown, `cc` probes
eligible seats using `claude -p Hi --model haiku`, with tools, MCP configuration,
slash commands and session persistence disabled. Probes run concurrently, ignore stdin, and have a 15-second timeout and
bounded output. Timeouts and overflow terminate the process group and close
inherited output pipes. Missing or malformed credentials are not probed. A normal
response makes a seat available; failed probes remain unknown. Known healthy usage retains
the normal ranking. If only probed seats are available, selection uses fewest live
sessions + claims, then round-robin in registry order. A stderr notice identifies
fallback routing. If no available seat remains and exhaustion is not established,
`cc` exits 1 with the table and override hint.

Probes remove inherited `ANTHROPIC_*` variables (including `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL`), `CLAUDE_CODE_OAUTH_TOKEN*`, and
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and `CLAUDE_CODE_USE_FOUNDRY`.
They use the selected seat's home and config directory. Real sessions inherit the
caller's auth/provider environment; unset these overrides before using seat routing.
`cc doctor` and every automatic/manual launch identify them without displaying
their values. Launch warnings appear before the seat announcement. Seat settings should
also use keychain OAuth rather than an `apiKeyHelper` or another authentication
override; the router does not inspect or rewrite those settings.

A limit message such as `hit your session limit · resets 13:50` places that seat
in cooldown until the next occurrence of that clock. `1:50pm` and `1pm` are also
accepted. Clocks use local time unless the message supplies a timezone such as
`(Europe/Berlin)`, including daylight-saving changes. Active cooldowns are honoured
across invocations, even with cached headroom, and expire automatically. If all
four registered seats are exhausted or cooling down, `cc` exits 3 with cooldown
clocks in the table and the manual override hint. `cc @<seat>` still bypasses
automatic checks.

`fallback.json` in the state directory stores only validated cooldown timestamps,
seat names, and the last fallback selection, so round-robin continues after claims
expire. Writes are atomic and use mode `0600`. Probe output is never printed,
logged or stored. Corrupt, inaccessible or unwritable fallback state refuses
automatic launches; manual overrides remain available.

`@main`, `@dev`, `@dev2`, and `@dev3` select a seat. `@main` removes an inherited
`CLAUDE_CONFIG_DIR`; the other seats set it to their directory. A launch runs Claude
in a subshell, so the calling shell survives the session and keeps its scrollback,
while Claude inherits its input/output and exit status. The seat's `HOME` and
`CLAUDE_CONFIG_DIR` stay inside that subshell and never reach the caller.
Before launching, the shim checks for an external executable, looking on `PATH`
when given a command name. A missing or non-executable target returns 127 with a
diagnostic, leaving the caller's shell, `HOME`, and `CLAUDE_CONFIG_DIR` unchanged.
`cc @` prints each seat's directory, keychain slot, credential presence, usage,
and `live` process count, then returns to the shell. Usage looks like
`5h 10% ↻17:20  7d 1% ↻Fri 13:00`: percentages are utilization, and reset clocks
use the machine's local timezone. Both the table and statusline round displayed
percentages to integers, capped at 100%; routing and caches retain the original
values. A known percentage with no reset clock is shown as `5h 0%`, without a
clock marker. Directories are quoted to keep unusual paths on one row. `.claude-api` is never a seat. An unknown selector exits 2 and lists the
valid names.

The `live` column counts distinct live PIDs parsed from each seat's
`sessions/<pid>.<sha256>.key` filenames (64 lowercase hex characters), matching
Claude Code's messaging-key files. Their contents are not read. `main` uses the
bare `.claude/sessions` directory under the effective seat home. Signal-0 checks
exclude stale entries without signaling the process; permission-denied checks
still indicate a live process. Missing or unreadable directories count as zero.
Malformed names, temporary `.key.tmp.<hex>` files, subdirectories and symlinks
are ignored. Key files are never modified or removed.

Usage is fetched per seat with a 5-second timeout and cached for 60 seconds.
When a refresh fails, last-good data up to 10 minutes old is displayed with an age
such as `(cached 3m ago)`. Without usable cached data, the row shows `?` and a safe
error class, such as `HTTP 429`, `HTTP 5xx`, or `timeout`. Missing credentials show
`not logged in`; malformed credentials show `invalid credential`. An unavailable
credential store shows `unknown` presence and a diagnostic. These row failures do
not affect other seats, and the table command still exits 0. Credential presence
alone does not mean the login is valid.

Cache files are `usage-<seat>.json` under the state directory, replaced atomically
with mode `0600`. They contain only the fetch timestamp and validated usage/reset
values; credentials, extra response fields, and error bodies are never stored.
Cache read/write failures do not prevent displaying available usage.

Only the first argument can select a seat. A leading `-r` after that optional selector
becomes `--resume`. All other arguments, including `--`, go to Claude unchanged:
`cc @dev2 -- @main` passes `-- @main` to the `dev2` session;
`cc -- @dev2` passes both arguments to the automatically selected seat.

When a seat runs dry, quit Claude and run `cc -r` from the project directory. The
router chooses a seat with headroom and starts Claude's own `--resume` picker.
`cc -r <session-id>` passes the exact session ID to Claude without opening the
picker. `cc @dev -r` and `cc @dev -r <session-id>` pin the resume to `dev`, even
when automatic routing would refuse it. Leading `--resume` works the same way.
Resume uses the same claims, ranking, fallback, and exhaustion checks as new sessions.

`/seat` moves a running session without the picker. For each launch, `bin/cc.zsh`
creates an empty hand-off file and adds `mod/` to `CLAUDE_CODE_PLUGIN_DIRS`, so
Claude Code loads the `seat-handoff` mod. It also exports `CLAUDE_SEATS_HANDOFF_FILE`,
`CLAUDE_SEATS_CURRENT` (the seat), `CLAUDE_SEATS_NAMES` (the registry, space
separated) and `CLAUDE_SEATS_ENTRYPOINT` (the router script). The mod registers `/seat` only when the hand-off file variable is set.
`/seat <seat>` refuses an unknown seat and the current seat. Otherwise it writes
`<seat>\n<session-id>\n` (an empty first line for the best other seat; `new` in place
of the ID before the first prompt, when Claude Code has no transcript yet) and queues
`/exit`. When Claude exits, the shell function reads and deletes the file. A valid
UUID session ID starts `cc @<seat> -r <id>`, or `cc -r <id>` with
`CLAUDE_SEATS_AVOID=<current seat>`; `new` starts the same commands without `-r`, which removes that seat from routing for this
launch only. Any other content ends `cc` with Claude's exit status. The mod also
handles `session.measure`: when a 5h or 7d window reaches 90 %, it pins a status line
under the prompt, and clears it when no window is at 90 %.

`/seats` opens a pane with one button per seat and redraws it when
`node $CLAUDE_SEATS_ENTRYPOINT panel` answers. `cc panel` prints `display`, a NUL,
and a JSON array of `{seat, text, alert}`: `text` is the padded menu bar row and
`alert` is true where the menu bar colours the row red. The first nine buttons get
the hotkeys `1`–`9`. A pressed button goes through the same checks and hand-off
file as `/seat <seat>`; a refused seat shows a toast and leaves the pane open. A
failed `cc panel` shows its first stderr line in the pane.

Cross-seat discovery depends on the existing shared session store: the four seats'
`projects/` directories must point into `<seat-home>/.claude-shared/projects/`.
The router does not copy transcripts or implement a picker. `cc doctor` verifies
the shared layout. Automated handoff tests use a temporary tree and a fake
Claude executable to check discovery and persisted context across seats; they do
not exercise the real interactive picker or a model response.

Before every launch, including a new session, `cc` sets
`autoContinueAtUsageLimit: false` in the shared settings hub at
`<seat-home>/.claude/settings.json`. The other seats use their existing settings
symlinks to this hub. This makes an exhausted session fail promptly so the user can
quit and resume elsewhere instead of waiting for the limit to reset. The edit is
atomic, preserves unrelated settings and file permissions, and makes no write when
already disabled. A concurrent settings edit detected during staging gets one retry
against the newer contents and permissions; repeated conflicts refuse the launch.
Missing hub settings are created with mode `0600`. Invalid,
unreadable, symlinked, or unwritable hub settings refuse the launch with exit 1;
config contents are never printed. Listing or routing refusals leave settings alone.

The function resolves its TypeScript entrypoint when sourced, so it works from any
directory, including when the source file is a symlink. Do not invoke `src/cli.ts`
directly for interactive use: its stdout is a private NUL-delimited reply consumed
by the function. No generated shell code is evaluated.

## Menu bar

`cc menu` prints the seat table in [SwiftBar](https://github.com/swiftbar/SwiftBar)
plugin format: a title naming the seat with the most headroom, one clickable line
per seat, and a refresh item. It takes no arguments and writes nothing to stderr,
so a broken seat shows up as a red row rather than a notification.

```
brew install --cask swiftbar
ln -s "$PWD/bin/claude-seats.5m.sh" ~/SwiftBar/claude-seats.5m.sh
```

The `.5m.` in the filename is SwiftBar's refresh interval; rename the symlink to
change it. The plugin sources the installed shim, so it follows this checkout.
SwiftBar starts with a bare `PATH`, which is why the plugin names the Node
locations itself. Clicking a seat opens Terminal and launches that seat through an
interactive zsh. The first run prompts once per keychain item because SwiftBar is
not the terminal that was granted access; answer "Always Allow".

## Statusline

Before each launch, `cc` wires `src/statusline-cli.mjs` into the shared hub's
`statusLine.command`. Existing seat settings symlinks pick it up automatically,
including a bare `main` session. No extra shell setup is needed. The stored command
uses absolute paths to Node and this checkout, so keep both in place. Listing
seats does not change settings. The edit is atomic and idempotent, preserves
unrelated settings and `statusLine.padding`, and refuses invalid settings safely.
Doctor and ordinary launches retain the installed Node path while it remains an
executable file, even when a version manager selects another Node in the current
directory. An explicit `cc install` selects the current Node. Doctor reports a
missing or non-executable saved runtime without changing files; a launch repairs it.

After upgrading Node or moving this checkout, source its `bin/cc.zsh` with the new
Node and run `cc install`. Rewiring replaces obsolete adapter paths and preserves
the original prefix command, even if an earlier installation nested several
adapters. The obsolete Node executables and checkouts do not need to exist.

When a statusline command already exists, the adapter gives it the same stdin and
environment and retains its output through the model / cwd / git / context prefix,
byte for byte, including ANSI colors. It replaces the trailing
`sess … | wk … | identity` with the segment below. The identity may be an email or
the account's fallback display name. Either usage window, both windows,
or the identity may be absent; the context prefix is retained in every case, including
a non-git directory with only model / cwd / context fields:

```text
dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00
```

The seat comes from `CLAUDE_CONFIG_DIR` (`main` when unset), using the effective
seat home. Symlink aliases of a registered config directory or the seat home resolve
to the same seat and cache; unrelated or broken aliases remain `unknown`.
Live `rate_limits` from Claude's JSON stdin take precedence; each
missing window falls back to that seat's router cache, without a routing-age cutoff.
Missing or corrupt caches show `5h — · 7d —`. An invalid or missing stdin reset
clock keeps its valid live percentage and omits only the clock, rather than
substituting stale cached usage. Clocks use local time. The adapter
reads no credentials, contacts no usage endpoint and writes no state during rendering;
the existing prefix command still runs as before. Without a prior command, it
displays the seat/usage segment alone. Unrecognized prefix shapes pass through
unchanged; a trailing email or recognized usage fields can still be removed.
A fallback display name is removed only after a recognized context boundary.
Failed commands produce the seat segment alone, without exposing their output
or stderr. Legacy commands have a one-second deadline and bounded
output. Timeout and overflow terminate the process group and close inherited
pipes; a closed statusline reader exits quietly.

The original personal script is absent from the repo. Prefix regressions use a
synthetic renderer with independent usage windows, optional git and email segments.
The typechecked JavaScript entrypoint starts the legacy command and flushes its
stdin before loading the TypeScript renderer, overlapping cold Python/TypeScript
startup without a build or generated files. The old `src/statusline-cli.ts` path
remains a compatibility entrypoint. `pnpm benchmark:statusline`
uses a separate representative workload: a shell wrapper, `cat`, a fresh Python
process, a git branch lookup, a 1,000-line transcript read and fixture identity.
It reports legacy-only and complete-adapter timings for 20 cold invocations per
live/cache/missing case, failing if any complete sample reaches 100 ms. That is a
measurement target, not a latency guarantee under host load or for arbitrary legacy
commands. The legacy command's work and OS scheduling are part of the measurement.

To measure a specific command explicitly, run
`pnpm benchmark:statusline --legacy-command '/path/to/prefix-command'`.
The benchmark supplies a disposable HOME, config directory, repository and transcript;
commands with hardcoded external paths may still access those paths. Normal automated
verification never runs the user's installed command. Python is otherwise only needed
if the prefix command uses it.

For a standalone suffix (without changing settings), pipe Claude's statusline JSON
to `node /path/to/claude-seats/src/statusline-cli.mjs`. The same home/state overrides
below apply. Settings are wired by `cc install` and checked before each launch.

## Claims and routing audit

Each automatic or manual launch normally reserves a seat in `claims.json` in the state
directory for 10 seconds. Claims count alongside live sessions until they expire;
expired claims are removed on the next reservation. A claim can briefly overlap a
new session's registry entry, or remain after a failed launch, but expires normally.
An exclusive `routing.lock` directory serializes the live-count read, choice,
reservation, and audit append across terminals. Usage requests happen before
acquiring this lock. Fallback probes, cooldown updates and the round-robin cursor
are handled in two phases: probes run outside the lock, then the selector re-reads
live counts, claims, cooldowns and the round-robin cursor under the lock before
reserving. A cooldown recorded while a probe was running takes precedence over
that probe's result. Slow probes do not consume another selector's lock wait.

Each selection or refusal appends one JSON line to `decisions.log`: timestamp
(`at`, Unix milliseconds), seat (`none` for refusals), mode, reason, and each seat's
live count, active claim count, 5h/7d utilization, and eligibility. Cooldown rows
also include `cooldownUntil` (Unix milliseconds); probed rows keep unknown usage
percentages instead of inventing numbers. Manual overrides
are logged with mode and reason `manual`. They do not check credentials or request
usage, so their utilization fields are `unknown`. Leading `-r` or `--resume` adds
`resume: true`; an explicit UUID session ID also adds `sessionId`, including for
fallback routing, exhaustion refusals, and manual lock bypasses. Free-text resume
searches and all other arguments, credentials, and external error text are never
included in the audit. New claims and log files use
mode `0600`; claims are replaced atomically.

State or audit failures exit 1 without launching, including manual overrides when
`claims.json` is corrupt or unreadable. This is separate from the automatic-only
`fallback.json` state. Claims read failures name the exact file and append a refusal
with reason `claims unavailable`, seat `none` and empty rows (no trustworthy claims
snapshot). Repair that file before retrying. If `decisions.log` itself cannot be
written, no audit record can be guaranteed. Lock contention waits about two
seconds. Automatic selection then returns a diagnostic; a manual override proceeds
if it can append its audit entry. That entry retains mode and reason `manual`, adds
`reservation: "skipped: routing busy"`, and has empty `rows` because no locked
snapshot was read. The override leaves the lock and claims untouched, so it has no
launch claim for other selectors to count until its live session is registered.

A selector forcibly killed while holding the lock can leave it behind. Locks older
than 20 seconds recover automatically on the next attempt: legacy empty locks can
be replaced, and new locks carry a unique owner marker and PID so a live owner is
never displaced just because it is slow. New lock directories are published
atomically with their marker, so simultaneous recovery attempts cannot overwrite
another selector's reservation. Recent orphan locks still time out; retry after
the age threshold or use a manual override. Unrecognized lock contents are left
untouched and require inspection.

## Project settings before launch

Before every launch, `cc` syncs the four seats' per-project
`hasTrustDialogAccepted`, `mcpServers`, `allowedTools`, and
`enabledMcpjsonServers`. `main` uses `<seat-home>/.claude.json`; the other seats
use `<seat-home>/.claude-<seat>/.claude.json`. The home override applies to all
four paths. Listing seats with `cc @` does not sync.

Missing settings follow the user across seats. Tool and enabled-server lists are
deduplicated unions, retaining local entries first. An existing MCP server's whole
definition wins over other seats' definitions with the same name. As specified in
the design, an explicit local trust value also wins, including `false`. If a
destination has no value, sources are considered in registry order: `main`, `dev`,
`dev2`, `dev3`. Identity, feature flags, cost stats, top-level MCP settings, and all
other unsynced data retain their original bytes.

Changed files are replaced with a temporary file and rename in the same directory,
preserving file permissions. Missing files are created with mode `0600` only when
there are settings to import. A second sync performs no writes. Unreadable,
malformed, or symlinked config files are reported by seat and skipped; write failures
also produce a diagnostic, and the launch proceeds. Changes detected while staging
are skipped to avoid overwriting them. Atomic replacement prevents partial reads;
it does not lock out Claude's own concurrent writes.

## Development

The install/doctor acceptance suite runs entirely in temporary homes:

```sh
node --test tests/install-*.test.ts
```

It installs through `cc install`, opens fresh interactive zsh processes with only
the fixture `.zshrc` source line, and verifies four simultaneous launches choose
four different seats in `decisions.log`. It then marks one seat's usage cache at
100%, verifies new sessions and resume exclude it, and reads its persisted context
through another seat. Fixture credential files contain no OAuth data; the fake
Claude executable models persistence and picker discovery. These tests do not
prove a live model answer or operate the real interactive picker.

Real-seat smoke checks are separate and explicit: run `cc doctor` and `cc @` in
a newly opened terminal, launch `cc` in four terminals and inspect their seat
announcements, then quit a session on a dry seat and use `cc -r` to ask about its
prior context. Automated verification never performs that smoke set or installs
into the real home.

Use Node 24 (`.mise.toml`) and pnpm 10.28.1 (`packageManager` in `package.json`).
With those on `PATH`, a fresh clone needs only:

```sh
pnpm install
pnpm verify
```

If your shell resolves another Node version, use the mise shims:

```sh
PATH="$HOME/.local/share/mise/shims:$PATH" pnpm verify
```

`pnpm verify` runs `tsgo --noEmit`,
`oxlint --type-aware --deny-warnings --report-unused-disable-directives`,
`biome check --error-on-warnings`, then `node --test`, stopping at the first failure.
Warnings and unused Oxlint suppressions fail verification; config tests also reject
`warn` severities. All dependencies are development tools;
the CLI uses Node built-ins only. There is no build or transpilation step. Use `.ts`
extensions in relative imports and `import type` for types.

Oxlint enables every category, including nursery, as errors. Biome enables every rule
group as errors, formats code, and organizes imports. The few conflicting or
runtime-inappropriate rules have explanations beside their configuration exceptions.
`src/output.ts` is the designated CLI output module and the only source file permitted
to use `console`. Do not pass credentials or other secrets to it.

`pnpm test` discovers TypeScript tests, including nested `src/**/*.test.ts`, directly
through Node's built-in test runner. Unit tests live beside the core modules. The
tooling and zsh integration tests in `tests/` use disposable directories, synthetic
credentials, a local fake usage server, and a fake Claude executable. Unit tests
replace credential/network I/O with fakes. No test reads the real keychain,
contacts Anthropic, or touches real seats. The captured usage response fixture's
public source is recorded in `tests/fixtures/README.md`. Tooling tests also check
deliberately invalid projects.

## Environment seams

These optional overrides define the testability contract. All five are implemented
for automatic routing, manual launches, and usage display. With them pointed at a
temporary test setup,
end-to-end tests run without accessing real seats.

| Variable | Default when unset | Purpose |
|---|---|---|
| `CLAUDE_SEATS_HOME` | `$HOME` | Directory containing the seat config directories (`.claude`, `.claude-dev`, `.claude-dev2`, `.claude-dev3`). |
| `CLAUDE_SEATS_STATE_DIR` | `$CLAUDE_SEATS_HOME/.claude-shared/_seats` (using `$HOME` if the home override is unset) | Router state: usage cache, cooldowns, claims, and `decisions.log`. |
| `CLAUDE_SEATS_USAGE_URL` | `https://api.anthropic.com` | Usage endpoint base; requests append `/api/oauth/usage`. HTTPS is required except for loopback HTTP (`127.0.0.1`, `::1`, `localhost`) fixture servers. |
| `CLAUDE_SEATS_CLAUDE_BIN` | `claude` resolved from `PATH` | Claude executable; point it at a fake binary to capture launches in tests. |
| `CLAUDE_SEATS_KEYCHAIN_DIR` | Unset: use the macOS keychain | Fixture-only alternative: read `<slot>.json` files from this directory instead of the keychain. Empty values are rejected. Never set this for normal operation. |

The launched process uses the effective seat home as `HOME`. This also isolates
`main` when `CLAUDE_SEATS_HOME` differs from the caller's home, while keeping
`CLAUDE_CONFIG_DIR` unset. Non-main slot hashes use the absolute config-directory
path under that home. A regular `<slot>.json` fixture file counts as present; usage
refreshes also validate its JSON and require a nonempty `claudeAiOauth.accessToken`
string. Use a clearly synthetic value in fixtures. `{}` is present but displays
`invalid credential` when a refresh is needed. Normal keychain presence checks
query metadata; usage refreshes read the password JSON into memory. Fresh cache
hits need only the presence check and make no token read or network request.

Fixture credentials must be synthetic. Real OAuth tokens stay in memory: never write,
log, print, or include them in error messages.

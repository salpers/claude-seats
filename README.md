# claude-seats

![Node 24+](https://img.shields.io/badge/node-24%2B-339933?logo=nodedotjs&logoColor=white)
![macOS](https://img.shields.io/badge/platform-macOS-000000?logo=apple&logoColor=white)
![zsh](https://img.shields.io/badge/shell-zsh-4EAA25?logo=gnubash&logoColor=white)
![No runtime deps](https://img.shields.io/badge/runtime%20deps-0-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-yellow)

**One `cc` command for Claude Code on four accounts ("seats").**

`cc` starts each new session on the seat with the lowest usage.
When a seat is at its limit, `cc -r` moves your session to a different seat.

> [!NOTE]
> This is personal tooling for one macOS user with four Claude Code logins.
> It reads OAuth tokens from the macOS keychain.
> It calls `/api/oauth/usage`, an internal Anthropic endpoint that can change without notice.

## Features

| | Feature | What it does |
|---|---|---|
| 🧭 | **Auto-routing** | Starts each session on the seat with the lowest usage. |
| ⚖️ | **Load spread** | Puts concurrent sessions on different seats. |
| 🔁 | **Hand-off** | Resumes a session on a different seat with `cc -r`. |
| 🛟 | **Fallback** | Uses cached usage or a small probe when the usage endpoint fails. |
| 📊 | **Statusline** | Shows the seat and its 5h / 7d usage in Claude Code. |
| 🖥️ | **Menu bar** | Shows all seats in the macOS menu bar (SwiftBar). |
| 🔗 | **Project sync** | Copies trust, MCP servers and allowed tools to all seats. |

## Seats

| Seat | Config directory | Keychain slot |
|---|---|---|
| `main` | `~/.claude` (`CLAUDE_CONFIG_DIR` unset) | `Claude Code-credentials` |
| `dev`, `dev2`, `dev3` | `~/.claude-<seat>` | `Claude Code-credentials-<hash>` |

Each seat keeps its own login.
All seats share sessions, history and settings through `~/.claude-shared/` and `~/.claude`.

> [!IMPORTANT]
> The seat names are fixed in [`src/seats.ts`](src/seats.ts).
> To change the names or the number of seats, edit `SeatName` and `names` in that file, then update the tests.
> A seat `<name>` uses `~/.claude-<name>`. Only `main` uses `~/.claude`.

## Install

**Requirements:** macOS, zsh, Node 24 or newer, Claude Code on `PATH`, one login per seat.

1. Clone this repository to a permanent location.
2. Load the shim and install:

   ```zsh
   source /path/to/claude-seats/bin/cc.zsh
   cc install
   ```

3. Add this line to `~/.zshrc`, after your Node setup:

   ```zsh
   source "${CLAUDE_SEATS_HOME:-$HOME}/.claude-shared/bin/cc.zsh"
   ```

4. Open a new terminal.
5. Run `cc doctor`. It must exit with code 0.
6. Run `cc @` to see the usage of each seat.

`cc install` does these steps:

- Links `projects/`, `history.jsonl`, `file-history/`, `shell-snapshots/` and `tasks/` of each seat to `~/.claude-shared/`.
- Links `settings.json` of `dev`, `dev2` and `dev3` to `~/.claude/settings.json`.
- Sets the statusline and `autoContinueAtUsageLimit: false`.
- Does not read credentials, log in or change `.zshrc`.
- Stops before it changes a file if it finds conflicting data.

> [!WARNING]
> In interactive zsh, `cc` hides `/usr/bin/cc` (the C compiler).
> To compile C, use `command cc` or `/usr/bin/cc`.
> Scripts and Makefiles are not affected.

## Usage

| Command | Result |
|---|---|
| `cc [args…]` | Start Claude on the best seat. Claude gets all arguments. |
| `cc @<seat> [args…]` | Start Claude on this seat. Skip the usage checks. |
| `cc -r` | Resume on the best seat. Open the Claude session picker. |
| `cc -r <session-id>` | Resume this session on the best seat. |
| `cc @<seat> -r [<id>]` | Resume on this seat. |
| `cc @` | Show credentials, usage and live sessions for each seat. |
| `cc doctor` | Check the setup. Change nothing. |
| `cc install` | Install or repair the setup. |
| `cc menu` | Print the seat table in SwiftBar format. |

`cc` writes the selected seat to stderr, for example `cc: using dev2`.
Thus, you can pipe the Claude output.

<details>
<summary><b>Exit codes</b></summary>

| Code | Meaning |
|---|---|
| `0` | OK. A launch returns the Claude exit status. |
| `1` | Setup, state or routing error. `cc doctor` found a problem. |
| `2` | Unknown seat name. |
| `3` | All seats are at their limit or in cooldown. |
| `127` | The `claude` binary is missing or not executable. |

</details>

## How `cc` selects a seat

1. Remove each seat at 100 % on the 5h or 7d window.
2. Remove each seat in cooldown after a limit message.
3. Sort the remaining seats by these rules, in this order:
   1. Fewest live sessions and claims.
   2. 5h usage below 90 %.
   3. Lowest 7d usage.
   4. Registry order: `main`, `dev`, `dev2`, `dev3`.
4. If no seat is left, show the table and exit with code 3.

If the usage endpoint fails, `cc` uses cached data up to 10 minutes old.
If no cache is available, `cc` sends a small Haiku probe to each seat.

## Move a session to a different seat

When a seat is at its limit:

1. Quit Claude.
2. Run `cc -r` in the same project directory.
3. Select the session in the picker.

All seats share the session store, so each seat can find the session.

## Statusline

`cc` keeps your statusline command.
It replaces only the usage and account part at the end:

```text
model | ~/project | main | ctx 12% | dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00
```

The statusline does not read credentials and does not call the network.

## Menu bar

```zsh
brew install --cask swiftbar
ln -s "$PWD/bin/claude-seats.5m.sh" ~/SwiftBar/claude-seats.5m.sh
```

- The title shows the seat with the lowest usage.
- Click a seat to start it in Terminal.
- `.5m.` in the file name sets the refresh interval to 5 minutes.

> [!TIP]
> On the first run, macOS asks for keychain access once for each seat. Select **Always Allow**.

## Data and security

- OAuth tokens stay in memory. `cc` does not write, log or print them.
- State goes to `~/.claude-shared/_seats/` (mode `0700`, files `0600`).
- The state has the usage cache, cooldowns, claims and `decisions.log`.
- `decisions.log` records each seat selection. It does not record arguments or credentials.
- Before each launch, `cc` sets `autoContinueAtUsageLimit: false`. Thus, a session stops at the limit and does not wait.

## Configuration

All variables are optional. Tests use them to isolate the real seats.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_SEATS_HOME` | `$HOME` | Directory with the seat config directories. |
| `CLAUDE_SEATS_STATE_DIR` | `$CLAUDE_SEATS_HOME/.claude-shared/_seats` | Router state. |
| `CLAUDE_SEATS_USAGE_URL` | `https://api.anthropic.com` | Usage endpoint base. HTTPS only, except loopback. |
| `CLAUDE_SEATS_CLAUDE_BIN` | `claude` from `PATH` | Claude executable. |
| `CLAUDE_SEATS_KEYCHAIN_DIR` | Unset: use the macOS keychain | Read `<slot>.json` files from this directory. Fixtures only. Never set this for normal operation. |

## Development

```sh
pnpm install
pnpm verify   # tsgo → oxlint → biome → node --test
```

- No build step. Node 24 runs the TypeScript directly.
- No runtime dependencies. All packages are development tools.
- Tests use temporary homes, fake credentials and a fake `claude` binary.
- Tests do not touch the real keychain, the real seats or Anthropic.

## More documentation

| Document | Content |
|---|---|
| [`docs/REFERENCE.md`](docs/REFERENCE.md) | Full behavior: install, routing, claims, statusline, sync. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design decisions. |
| [`tickets/`](tickets/README.md) | Build tickets and test notes. |

## License

[MIT](LICENSE)

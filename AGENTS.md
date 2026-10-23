# AGENTS.md — conventions for every worker in this repo

Personal CLI tool, TypeScript on Node 24+, run directly (type-stripping) — **no build step**.
Read `docs/DESIGN.md` first; it is the authoritative spec.

## Toolchain (must stay green: `pnpm verify`)
- `pnpm verify` = `tsgo --noEmit` →
  `oxlint --type-aware --deny-warnings --report-unused-disable-directives` →
  `biome check --error-on-warnings` → `node --test`.
  Every change lands with `pnpm verify` exit 0. No suppress-comments (`// oxlint-disable`,
  `// biome-ignore`, `@ts-ignore`, `@ts-expect-error`) unless a one-line justification sits
  beside it and no rule-conforming alternative exists. Unused Oxlint suppressions fail
  verification. Justifications for `oxlint-disable-next-line <rule>` remain a review
  policy: Oxlint does not require a description for these directives.
- Develop and verify on Node 24; the CLI supports Node 24 and newer. If `node --version` is not 24.x, prefix commands with
  `PATH="$HOME/.local/share/mise/shims:$PATH"` (mise pins it via `.mise.toml`).
- Use `pnpm`; never `npm`/`yarn`/`npx`. Dependencies: dev-only tooling. Runtime uses
  Node built-ins only (`node:child_process`, `node:fs`, `node:crypto`, global `fetch`).
- Source must be **erasable TypeScript** (Node runs it without transpiling): no `enum`,
  no parameter properties, no namespaces, `import type` for types, `.ts` extensions in
  relative imports.

## Code rules
- **No `any`, no `as` casts, no non-null `!`.** Narrow with type guards; parse external
  JSON (keychain, usage endpoint, `.claude.json`, session registry) through hand-written
  validators returning discriminated unions — never trust the shape.
- Errors are values where control flow depends on them (`{ok: true, …} | {ok: false, reason}`).
  Throw only for programmer errors.
- Pure core, thin shell: routing, parsing, merging, formatting are pure functions in
  `src/` with unit tests beside them (`*.test.ts`, `node:test` + `node:assert/strict`).
  Side effects (keychain, network, fs, spawn) live behind small interfaces that tests
  replace with fakes. No network and no keychain in unit tests.
- **Secrets**: OAuth tokens are read from the keychain and used in memory only. They must
  never be written to disk, logged, printed, or included in error messages. Tests assert
  this where relevant.
- Comments explain *why*, never narrate *what*. No dead code, no TODOs without an issue.
- `mod/` is a Claude Code mod with no Node APIs at runtime. The mods validator requires
  the API parameter to be spelled `$`, `$` to reach only top-level functions in the same
  file, and every `$.env.get` name to be a literal; keep `claude plugin validate ./mod`
  passing. Pure UI logic lives in `mod/hooks/pane.ts`, which takes the resolved elements
  instead of `$`.

## Testability seams (required — the e2e suite depends on them)
Environment overrides, all optional, all documented in `README.md`:
- `CLAUDE_SEATS_HOME` — directory containing the seat config dirs (default `$HOME`).
- `CLAUDE_SEATS_STATE_DIR` — router state: usage cache, cooldowns, claims, decisions.log
  (default `$CLAUDE_SEATS_HOME/.claude-shared/_seats`).
- `CLAUDE_SEATS_USAGE_URL` — usage endpoint base (default `https://api.anthropic.com`).
- `CLAUDE_SEATS_CLAUDE_BIN` — the `claude` binary to exec (default resolved from `PATH`).
- `CLAUDE_SEATS_KEYCHAIN_DIR` — when set, read `<slot>.json` files from this dir instead of
  the macOS keychain (fixtures only; never used in normal operation).
With these set to a temp tree the whole CLI must run end-to-end with no real seats touched.

## Working a change
1. Read the issue and `docs/DESIGN.md`. Red → green → refactor; the acceptance
   criteria become tests wherever they can.
2. `pnpm verify` green. Then commit **only this change's files** with a conventional-commit
   subject, e.g. `feat(router): auto-route new sessions`.
   Never `git add -A`. Never push. Never switch branches.
3. Report honestly: if something in the issue cannot be met, say what and why — do not
   quietly narrow it.

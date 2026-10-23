---
name: merge-seat-conflicts
description: Merge the files cc migrate set aside in ~/.claude-shared/_conflicts back into the shared store.
disable-model-invocation: true
---

# Merge seat conflicts

`cc migrate` moves every seat's sessions, memory and history into the shared store
`<seat-home>/.claude-shared/`. When a seat file and a shared file had the same path but
different content, it kept the shared file and set the seat file aside at
`<seat-home>/.claude-shared/_conflicts/<seat>/<path>`. `<path>` is relative to the shared
store, for example `projects/<project>/memory/<name>.md`. `<seat-home>` is
`$CLAUDE_SEATS_HOME` when set, else `$HOME`.

Each set-aside file is a **twin** of the **live** file at the same `<path>` in the shared
store. The live file is usually newer: sessions kept editing it after the migration.

## Steps

1. **Back up.** Copy `_conflicts/` and each live file that has a twin into
   `<seat-home>/.claude-shared/_merge-backup-<UTC yyyymmdd-hhmmss>/`, keeping relative
   paths. Done when the backup holds every twin and every live file.
2. **List.** Collect every regular file under `_conflicts/` with its kind (below).
   Done when every twin is on the list.
3. **Merge** each twin by its kind's rule. Done when the live file holds every fact of the
   twin that is still true, and keeps everything it already had.
4. **Clear.** Delete each merged twin, then empty directories. Done when `_conflicts/` is
   gone, or holds only twins you kept aside.
5. **Report** one line per twin: path, then `merged <n> facts`, `already covered`, or
   `kept aside: <reason>`. End with the backup path.

## Kinds

**Memory file**: `projects/<project>/memory/<name>.md`, except `MEMORY.md`. Frontmatter,
then a body of facts.

- Add each twin fact the live file lacks, under the heading it belongs to.
- Same fact, different wording: keep the live wording; fold in any detail only the twin
  has (number, date, path, name, link).
- Contradiction: the later state wins. Judge by dates and status words in the text
  (`MERGED`, `CLOSED`, a later date). If the live file keeps a status or history line,
  record the older state there. If you cannot tell which is later, keep both with their
  dates and report `kept both: <fact>`.
- Keep the live frontmatter. Widen `description` only when the added facts change what
  the file covers.
- Write dates as absolute dates.

**Memory index**: `projects/<project>/memory/MEMORY.md`, a list of pointers to memory
files. Read the twin index for its pointers only. Add a twin pointer to the live index
when its target file exists and no pointer reaches it from the live index or from a file
the live index links. Pointers to missing files stay out.

**JSON Lines** (`*.jsonl`): append each twin line the live file lacks. When the lines
carry a numeric `timestamp`, order the result by it.

**Seat settings**: `_conflicts/<seat>/settings.json`. Its live file is the hub
`<seat-home>/.claude/settings.json`, outside the shared store. Add each twin key the hub
lacks. Merge arrays such as `permissions.allow` as a union. When both set the same scalar
key, keep the hub value and report the twin value.

**Anything else**: when one file contains the other, keep the larger as the live file.
Otherwise keep the twin aside and report it.

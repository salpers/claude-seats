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
Other sessions may write the shared store while you work.

## Steps

1. **Back up.** Copy `_conflicts/` and each live file that has a twin into
   `<seat-home>/.claude-shared/_merge-backup-<UTC yyyymmdd-hhmmss>/`, each at its path
   relative to the shared store (`_conflicts/<seat>/<path>` and `<path>`). Done when the
   backup holds every twin and every live file.
2. **List.** Collect every regular file under `_conflicts/` with its kind (below).
   Done when every twin is on the list.
3. **Merge** each twin by its kind's rule. Re-read the live file right before you edit
   it, and edit it in place. Done when the live file holds every twin fact its kind's rule
   keeps, and everything it already had.
4. **Clear.** Diff the backup against the live store first: a live file you did not edit
   that changed means another session wrote it, so merge its twin again. Then delete each
   merged twin and the empty directories. Done when `_conflicts/` is gone, or holds only
   twins you kept aside.
5. **Report** one line per twin, `<seat>/<path>`, then one of `merged <n> facts`,
   `added <n> pointers`, `already covered`, `kept both: <fact>` or `kept aside: <reason>`.
   End with the backup path.

## Kinds

**Memory file**: `projects/<project>/memory/<name>.md`, except `MEMORY.md`. Frontmatter,
then a body of facts. `[[name]]` links the memory file `name.md` beside it.

- A twin fact is present when the live file, or a memory it links, holds it. A twin link
  is present when the live file links a memory whose frontmatter `mergedFrom` names it.
- Add each twin fact that is absent, under the heading it belongs to.
- Same fact, different wording: keep the live wording; fold in any detail only the twin
  has (number, date, ID, path, link).
- Contradiction: the later state wins. Judge by dates and status words in the text
  (`MERGED`, `CLOSED`, a later date), then by file mtime, then by a quick check (the path
  exists, a grep of the base branch). If the live file keeps a status or history line,
  record the older state there. When nothing settles it, keep both with their dates and
  report `kept both: <fact>`.
- When the live file was rewritten after the twin's mtime, it was condensed on purpose:
  add only facts that change what a reader does, plus dates and IDs for events it already
  names. Superseded steps (review rounds, interim states) stay out.
- Fold in a path or `[[link]]` only when its target exists and it belongs to the fact
  beside it.
- Keep the live frontmatter. Widen `description` only when the added facts change what
  the file covers. Write dates as absolute dates.

**Memory index**: `projects/<project>/memory/MEMORY.md`, a list of pointers to memory
files. Read the twin index for its pointers only. A memory is reachable when the live
index, or a file the live index links (one hop, such as a topic hub), names it. Add a twin
pointer when its target file exists and is not reachable. When you add a pointer to a hub
whose memory count `MEMORY.md` shows, update the count.

**JSON Lines** (`*.jsonl`): append each twin line the live file lacks. When the lines
carry a numeric `timestamp`, order the result by it.

**Seat settings**: `_conflicts/<seat>/settings.json`. Its live file is the hub
`<seat-home>/.claude/settings.json`, outside the shared store. Add each twin key the hub
lacks. Merge arrays such as `permissions.allow` as a union. When both set the same scalar
key, keep the hub value and report the twin value.

**Anything else**: when one file contains the other, keep the larger as the live file.
Otherwise keep the twin aside and report it.

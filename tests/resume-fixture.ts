import { ok, strictEqual } from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const sessionId = "11111111-2222-4333-8444-555555555555";
const priorContext = "Remember that the orchard has seven pear trees.";
const settingsFile = (setup: Fixture): string =>
	path.join(setup.home, ".claude/settings.json");
const last = -1;
const success = 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// This executable models persistence and picker discovery; it does not call a model.
const fakeSessionClaude = `#!/bin/zsh -f
exec node --input-type=module -e '
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(1);
const directory = process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME, ".claude");
const settings = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
if (settings.autoContinueAtUsageLimit !== false) process.exit(41);
const projects = path.join(directory, "projects", "fixture-project");
await mkdir(projects, { recursive: true });
if (args[0] === "--session-id") {
  await writeFile(path.join(projects, args[1] + ".jsonl"), JSON.stringify({ origin: path.basename(directory), context: args[2] }) + "\\n");
  process.stdout.write("created\\n");
} else if (args[0] === "--resume") {
  if (args[1]) {
    const session = JSON.parse(await readFile(path.join(projects, args[1] + ".jsonl"), "utf8"));
    process.stdout.write(session.origin + ": " + session.context + "\\n");
  } else {
    process.stdout.write((await readdir(projects)).join("\\n") + "\\n");
  }
} else {
  process.exit(42);
}
' -- "$@"
`;

const installSharedStore = async (setup: Fixture): Promise<void> => {
	const projects = path.join(setup.home, ".claude-shared/projects");
	await mkdir(projects, { recursive: true });
	await mkdir(path.dirname(settingsFile(setup)), { recursive: true });
	await writeFile(
		settingsFile(setup),
		'{ "autoContinueAtUsageLimit": true, "permissions": {"allow":["Read"]} }\n',
	);
	await Promise.all(
		[".claude", ".claude-dev", ".claude-dev2", ".claude-dev3"].map(
			async (name): Promise<void> => {
				const directory = path.join(setup.home, name);
				await mkdir(directory, { recursive: true });
				await symlink(projects, path.join(directory, "projects"));
				if (name !== ".claude") {
					await symlink(
						settingsFile(setup),
						path.join(directory, "settings.json"),
					);
				}
			},
		),
	);
	await writeFile(setup.binary, fakeSessionClaude);
};

const decisions = async (
	setup: Fixture,
): Promise<readonly Record<string, unknown>[]> => {
	const text = await readFile(
		path.join(setup.directory, "state/decisions.log"),
		"utf8",
	);
	return text
		.trimEnd()
		.split("\n")
		.map((line) => {
			const parsed: unknown = JSON.parse(line);
			ok(isRecord(parsed));
			return parsed;
		});
};

const sessionFixture = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	await installSharedStore(setup);
	const created = await run(setup, [
		"@dev2",
		"--session-id",
		sessionId,
		priorContext,
	]);
	strictEqual(created.status, success, created.stderr);
	strictEqual(created.stdout, "created\n");
	return setup;
};

const assertDecision = async (
	setup: Fixture,
	expected: Readonly<Record<string, unknown>>,
): Promise<void> => {
	const entries = await decisions(setup);
	const entry = entries.at(last);
	ok(entry);
	for (const [key, value] of Object.entries(expected)) {
		strictEqual(entry[key], value);
	}
	strictEqual(JSON.stringify(entries).includes(priorContext), false);
	strictEqual(JSON.stringify(entries).includes("private prompt"), false);
};

export {
	assertDecision,
	decisions,
	fakeSessionClaude,
	priorContext,
	sessionFixture,
	sessionId,
	settingsFile,
};

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const executableMode = 0o700;
const sessionId = "11111111-2222-4333-8444-555555555555";
const root = path.dirname(import.meta.dirname);

// Logs each launch; the first launch acts like /seat: it writes the hand-off file and quits.
// It also clears the launch claims, as a session that ran past the claim lifetime does.
const fakeMovingClaude = `#!/bin/zsh -f
exec node --input-type=module -e '
import { existsSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(1);
const env = process.env;
const first = !existsSync(env.CLAUDE_SEATS_TEST_LOG);
await appendFile(env.CLAUDE_SEATS_TEST_LOG, JSON.stringify({
  args,
  avoid: env.CLAUDE_SEATS_AVOID ?? "",
  config: env.CLAUDE_CONFIG_DIR ?? "",
  current: env.CLAUDE_SEATS_CURRENT,
  file: env.CLAUDE_SEATS_HANDOFF_FILE,
  names: env.CLAUDE_SEATS_NAMES,
  plugins: env.CLAUDE_CODE_PLUGIN_DIRS,
}) + "\\n");
if (first) {
  await writeFile(env.CLAUDE_SEATS_STATE_DIR + "/claims.json", "[]\\n");
  await writeFile(env.CLAUDE_SEATS_HANDOFF_FILE, env.CLAUDE_SEATS_TEST_MOVE + "\\n");
}
' -- "$@"
`;

interface Launch {
	readonly args: readonly string[];
	readonly avoid: string;
	readonly config: string;
	readonly current: string;
	readonly file: string;
	readonly names: string;
	readonly plugins: string;
}
const isLaunch = (value: unknown): value is Launch =>
	typeof value === "object" && value !== null && "args" in value;

const moveFrom = async (
	setup: Fixture,
	args: readonly string[],
	move: string,
): Promise<
	Readonly<{
		launches: readonly Launch[];
		status: number | null;
		stderr: string;
	}>
> => {
	const binary = path.join(setup.directory, "moving-claude");
	const log = path.join(setup.directory, "launches.jsonl");
	await writeFile(binary, fakeMovingClaude);
	await chmod(binary, executableMode);
	const result = await run(setup, args, {
		env: Object.fromEntries([
			["CLAUDE_SEATS_CLAUDE_BIN", binary],
			["CLAUDE_SEATS_TEST_LOG", log],
			["CLAUDE_SEATS_TEST_MOVE", move],
		]),
	});
	const text = await readFile(log, "utf8");
	const launches = text
		.trim()
		.split("\n")
		.map((line): unknown => JSON.parse(line))
		.filter((entry) => isLaunch(entry));
	return { launches, status: result.status, stderr: result.stderr };
};

const gone = async (file: string): Promise<boolean> => {
	try {
		await access(file);
		return false;
	} catch {
		return true;
	}
};

const assertDevToDev3 = async (
	setup: Fixture,
	launches: readonly Launch[],
): Promise<void> => {
	const [first, second] = launches;
	ok(first && second);
	deepStrictEqual(
		[first.config, first.args, first.current, first.names],
		[path.join(setup.home, ".claude-dev"), [], "dev", "main dev dev2 dev3"],
	);
	ok(first.plugins.startsWith(path.join(root, "mod")));
	deepStrictEqual(
		[second.config, second.args, second.current],
		[path.join(setup.home, ".claude-dev3"), ["--resume", sessionId], "dev3"],
	);
	ok(await gone(first.file));
	ok(await gone(second.file));
};

await test("/seat dev3 quits Claude on dev, and cc resumes the session on dev3 with the mod loaded", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const moved = await moveFrom(setup, ["@dev"], `dev3\n${sessionId}`);
	strictEqual(moved.status, success, moved.stderr);
	strictEqual(moved.stderr, "cc: using dev\ncc: using dev3\nreturned:0\n");
	await assertDevToDev3(setup, moved.launches);
});

await test("/seat without a name resumes on the best seat other than the current one", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	// Dev has the most headroom, so only the hand-off keeps the router off it.
	await seedRouting(setup, {
		dev: { fiveHour: 1, sevenDay: 1 },
		dev2: { fiveHour: 10, sevenDay: 60 },
		dev3: { fiveHour: 10, sevenDay: 70 },
		main: { fiveHour: 10, sevenDay: 50 },
	});
	const moved = await moveFrom(setup, ["@dev"], `\n${sessionId}`);
	strictEqual(moved.status, success, moved.stderr);
	strictEqual(moved.stderr, "cc: using dev\ncc: using main\nreturned:0\n");
	const [, second] = moved.launches;
	ok(second);
	deepStrictEqual(
		[second.config, second.args, second.avoid],
		["", ["--resume", sessionId], ""],
	);
});

await test("/seat before the first prompt starts a new session on the target seat", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const moved = await moveFrom(setup, ["@dev"], "dev3\nnew");
	strictEqual(moved.status, success, moved.stderr);
	const [, second] = moved.launches;
	ok(second);
	deepStrictEqual(
		[second.config, second.args, second.current],
		[path.join(setup.home, ".claude-dev3"), [], "dev3"],
	);
});

import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const unavailable = 1;
const devPlanPattern =
	/dev: 1 to move, 1 identical, 2 to set aside, 0 blocked, 1 history file/u;
const mergeHintPattern = /merge-seat-conflicts skill/u;
const nothingPattern = /Nothing to migrate/u;
const quitPattern = /Quit every Claude session/u;
const sharePlanPattern =
	/dev: 0 to move, 0 identical, 0 to set aside, 0 blocked, 0 history file, 1 sessions folder to link/u;
const keepRunningPattern = /live Claude sessions keep running/u;
const keyMode = 0o600;
const modeBase = 0o1000;
const hashLength = 64;
const keyName = `${String(process.pid)}.${"0".repeat(hashLength)}.key`;
const history = (timestamp: number): string =>
	JSON.stringify({ display: `prompt ${String(timestamp)}`, timestamp });
const first = 1;
const second = 2;
const third = 3;

const put = async (
	setup: Fixture,
	file: string,
	text: string,
): Promise<void> => {
	const target = path.join(setup.home, file);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, text);
};
const read = async (setup: Fixture, file: string): Promise<string> =>
	readFile(path.join(setup.home, file), "utf8");

// Two unshared seats with an identical file, a conflicting file, histories and their own settings.
const unsharedSeats = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	await Promise.all([
		put(setup, ".claude/projects/p/a.jsonl", "main a"),
		put(setup, ".claude/projects/p/memory/x.md", "main x"),
		put(setup, ".claude/projects/p/memory/y.md", "same y"),
		put(setup, ".claude/settings.json", "{}\n"),
		put(
			setup,
			".claude/history.jsonl",
			`${history(first)}\n${history(third)}\n`,
		),
		put(setup, ".claude-dev/projects/p/b.jsonl", "dev b"),
		put(setup, ".claude-dev/projects/p/memory/x.md", "dev x"),
		put(setup, ".claude-dev/projects/p/memory/y.md", "same y"),
		put(
			setup,
			".claude-dev/history.jsonl",
			`${history(second)}\n${history(first)}\n`,
		),
		put(setup, ".claude-dev/settings.json", '{"model":"opus"}\n'),
	]);
	return setup;
};

const assertShared = async (setup: Fixture): Promise<void> => {
	strictEqual(await read(setup, ".claude-shared/projects/p/a.jsonl"), "main a");
	strictEqual(await read(setup, ".claude-shared/projects/p/b.jsonl"), "dev b");
	strictEqual(
		await read(setup, ".claude-shared/projects/p/memory/x.md"),
		"main x",
	);
	strictEqual(
		await read(setup, ".claude-shared/projects/p/memory/y.md"),
		"same y",
	);
	strictEqual(
		await read(setup, ".claude-shared/history.jsonl"),
		`${history(first)}\n${history(second)}\n${history(third)}\n`,
	);
};

const assertParkedAndLinked = async (setup: Fixture): Promise<void> => {
	strictEqual(
		await read(setup, ".claude-shared/_conflicts/dev/projects/p/memory/x.md"),
		"dev x",
	);
	strictEqual(
		await read(setup, ".claude-shared/_conflicts/dev/settings.json"),
		'{"model":"opus"}\n',
	);
	const linked = await Promise.all(
		[".claude/projects", ".claude-dev/projects"].map(
			async (link): Promise<boolean> => {
				const info = await lstat(path.join(setup.home, link));
				return info.isSymbolicLink();
			},
		),
	);
	ok(!linked.includes(false));
	strictEqual(
		await readlink(path.join(setup.home, ".claude-dev/settings.json")),
		path.join(setup.home, ".claude/settings.json"),
	);
};

await test("cc migrate only reports the plan; nothing moves", async (context: Context): Promise<void> => {
	const setup = await unsharedSeats(context);
	const planned = await run(setup, ["migrate"]);
	strictEqual(planned.status, success, planned.stderr);
	match(planned.stdout, devPlanPattern);
	strictEqual(await read(setup, ".claude/projects/p/a.jsonl"), "main a");
});

await test("cc migrate --apply moves seat data into the shared store, sets conflicts aside and links every seat", async (context: Context): Promise<void> => {
	const setup = await unsharedSeats(context);
	const applied = await run(setup, ["migrate", "--apply"]);
	strictEqual(applied.status, success, applied.stderr);
	match(applied.stdout, mergeHintPattern);
	await assertShared(setup);
	await assertParkedAndLinked(setup);
	const again = await run(setup, ["migrate"]);
	match(again.stdout, nothingPattern);
});

await test("cc migrate --apply refuses while a Claude session is live and moves nothing", async (context: Context): Promise<void> => {
	const setup = await unsharedSeats(context);
	await put(setup, `.claude-dev/sessions/${String(process.pid)}.json`, "{}");
	const refused = await run(setup, ["migrate", "--apply"]);
	strictEqual(refused.status, unavailable);
	match(refused.stderr, quitPattern);
	strictEqual(await read(setup, ".claude/projects/p/a.jsonl"), "main a");
});

const seedLiveRegistry = async (setup: Fixture): Promise<void> => {
	await Promise.all([
		put(setup, `.claude-dev/sessions/${keyName}`, '{"pidDomain":"local"}'),
		put(setup, `.claude-dev/sessions/${String(process.pid)}.json`, "{}"),
		put(setup, ".claude/sessions/1.json", "{}"),
	]);
	await chmod(path.join(setup.home, ".claude-dev/sessions", keyName), keyMode);
};

const assertSharedRegistry = async (setup: Fixture): Promise<void> => {
	const shared = path.join(setup.home, ".claude-shared/sessions");
	const links = await Promise.all(
		[".claude", ".claude-dev", ".claude-dev3"].map(async (seat) =>
			readlink(path.join(setup.home, seat, "sessions")),
		),
	);
	deepStrictEqual(links, [shared, shared, shared]);
	const files = await readdir(shared);
	deepStrictEqual(
		files.toSorted(),
		[`${String(process.pid)}.json`, keyName, "1.json"].toSorted(),
	);
	const key = await stat(path.join(shared, keyName));
	strictEqual(key.mode % modeBase, keyMode);
	const seatFiles = await readdir(path.join(setup.home, ".claude-dev"));
	deepStrictEqual(
		seatFiles.filter((name) => name.startsWith("sessions.")),
		[],
	);
};

await test("cc migrate --apply links every seat's sessions folder to one registry while a session is live", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedLiveRegistry(setup);
	const planned = await run(setup, ["migrate"]);
	match(planned.stdout, sharePlanPattern);
	match(planned.stdout, keepRunningPattern);
	const applied = await run(setup, ["migrate", "--apply"]);
	strictEqual(applied.status, success, applied.stderr);
	await assertSharedRegistry(setup);
	const again = await run(setup, ["migrate"]);
	match(again.stdout, nothingPattern);
});

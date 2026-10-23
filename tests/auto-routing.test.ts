import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { seedRouting, seedSessions } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run } from "./shim-fixture.ts";

const success = 0;
const unavailable = 1;
const exhausted = 3;
const one = 1;
const four = 4;
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const lines = async (
	setup: Fixture,
): Promise<readonly Readonly<Record<string, unknown>>[]> => {
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
const expectedRows = [
	{
		claims: 0,
		fiveHour: 10,
		live: 0,
		seat: "main",
		sevenDay: 100,
		status: "exhausted",
	},
	{
		claims: 0,
		fiveHour: 100,
		live: 0,
		seat: "dev",
		sevenDay: 1,
		status: "exhausted",
	},
	{
		claims: 0,
		fiveHour: 10,
		live: 1,
		seat: "dev2",
		sevenDay: 52,
		status: "healthy",
	},
	{
		claims: 0,
		fiveHour: 10,
		live: 2,
		seat: "dev3",
		sevenDay: 1,
		status: "healthy",
	},
];
const assertAutoLog = async (setup: Fixture): Promise<void> => {
	const [decision] = await lines(setup);
	ok(decision);
	strictEqual(decision["seat"], "dev2");
	strictEqual(decision["mode"], "auto");
	ok(typeof decision["reason"] === "string");
	ok(decision["reason"].includes("fewest live"));
	deepStrictEqual(decision["rows"], expectedRows);
};

await test("cc picks dev2 over exhausted seats and a busier dev3, logging its numbers and reason", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup, {
		dev: { fiveHour: 100, sevenDay: 1 },
		dev2: { fiveHour: 10, sevenDay: 52 },
		main: { fiveHour: 10, sevenDay: 100 },
	});
	await seedSessions(setup, "dev2", [process.pid]);
	await seedSessions(setup, "dev3", [process.pid, process.ppid]);
	const args = ["--", "@main", "", "a b", "line\nbreak"];
	const result = await run(setup, args);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using dev2\nreturned:0\n");
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev2"),
		...args,
	]);
	await assertAutoLog(setup);
});

await test("cc prefers dev3 at equal live counts when dev2 is at 92% on 5h", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup, {
		dev: { fiveHour: 100, sevenDay: 1 },
		dev2: { fiveHour: 92, sevenDay: 0 },
		main: { fiveHour: 100, sevenDay: 1 },
	});
	await seedSessions(setup, "dev2", [process.pid]);
	await seedSessions(setup, "dev3", [process.pid]);
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, ["set", path.join(setup.home, ".claude-dev3")]);
});

const assertRefusal = (
	result: Readonly<{ status: number | null; stdout: string; stderr: string }>,
): void => {
	strictEqual(result.status, exhausted);
	strictEqual(result.stdout, "");
	const refusalLines = result.stderr.split("\n");
	ok(refusalLines.some((line): boolean => line.startsWith("seat  5h")));
	for (const name of ["main", "dev", "dev2", "dev3"]) {
		ok(refusalLines.some((line): boolean => line.startsWith(`${name} `)));
	}
	ok(result.stderr.includes("100% ↻17:20"));
	ok(result.stderr.includes("100% ↻Fri 13:00"));
	ok(result.stderr.includes("cc @<seat>"));
	strictEqual(result.stderr.includes("Project sync"), false);
};
const assertRefusalLog = async (setup: Fixture): Promise<void> => {
	const [decision] = await lines(setup);
	ok(decision);
	strictEqual(decision["seat"], "none");
	strictEqual(decision["reason"], "all seats exhausted");
};
await test("all exhausted returns 3 with a reset table and override hint, without exec or project sync", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const full = { fiveHour: 100, sevenDay: 100 };
	await seedRouting(setup, { dev: full, dev2: full, dev3: full, main: full });
	const file = path.join(setup.home, ".claude.json");
	await writeFile(file, "private invalid config");
	assertRefusal(
		await run(setup, [], {
			env: Object.fromEntries([["TZ", "Europe/Berlin"]]),
		}),
	);
	strictEqual(await readFile(file, "utf8"), "private invalid config");
	await assertRefusalLog(setup);
});

const assertNextLaunch = async (
	setup: Fixture,
	name: string,
): Promise<void> => {
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, `cc: using ${name}\nreturned:0\n`);
};
await test("four sequential shell launches spread across all four healthy seats", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	await assertNextLaunch(setup, "main");
	await assertNextLaunch(setup, "dev");
	await assertNextLaunch(setup, "dev2");
	await assertNextLaunch(setup, "dev3");
	const decisions = await lines(setup);
	deepStrictEqual(
		decisions.map((entry) => entry["seat"]),
		["main", "dev", "dev2", "dev3"],
	);
});

await test("simultaneous independent cc processes serialize claims and append complete audit lines", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	const results = await Promise.all(
		Array.from({ length: four }, async () => run(setup, [])),
	);
	for (const result of results) {
		strictEqual(result.status, success, result.stderr);
	}
	strictEqual(
		new Set(results.map(({ stderr }: Readonly<{ stderr: string }>) => stderr))
			.size,
		four,
	);
	const decisions = await lines(setup);
	strictEqual(decisions.length, four);
	strictEqual(new Set(decisions.map((entry) => entry["seat"])).size, four);
});

await test("manual overrides need no usage or credentials and are logged and claimed", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@dev2", "--resume", "abc"]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev2"),
		"--resume",
		"abc",
	]);
	const [decision] = await lines(setup);
	ok(decision);
	strictEqual(decision["mode"], "manual");
	strictEqual(decision["reason"], "manual");
	strictEqual(decision["seat"], "dev2");
});

const assertBypassLog = async (setup: Fixture): Promise<void> => {
	const decisions = await lines(setup);
	strictEqual(decisions.length, one);
	const [decision] = decisions;
	ok(decision);
	deepStrictEqual(decision, {
		at: decision["at"],
		mode: "manual",
		reason: "manual",
		reservation: "skipped: routing busy",
		resume: true,
		rows: [],
		seat: "dev2",
	});
	const files = await readdir(path.join(setup.directory, "state"));
	deepStrictEqual(files.toSorted(), ["decisions.log", "routing.lock"]);
};
await test("an orphaned routing lock still permits an audited manual resume", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await mkdir(path.join(setup.directory, "state/routing.lock"), {
		recursive: true,
	});
	const result = await run(setup, ["@dev2", "--resume", "abc"]);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using dev2\nreturned:0\n");
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev2"),
		"--resume",
		"abc",
	]);
	await assertBypassLog(setup);
});

const seedBlockedAudit = async (
	setup: Fixture,
): Promise<() => Promise<void>> => {
	const state = path.join(setup.directory, "state");
	const lock = path.join(state, "routing.lock");
	await mkdir(lock, { recursive: true });
	await mkdir(path.join(state, "decisions.log"));
	const claimsFile = path.join(state, "claims.json");
	const claims = JSON.stringify([{ createdAt: Date.now(), seat: "main" }]);
	await writeFile(claimsFile, claims);
	const lockBefore = await stat(lock);
	return async (): Promise<void> => {
		strictEqual(await readFile(claimsFile, "utf8"), claims);
		deepStrictEqual(await stat(lock), lockBefore);
	};
};
await test("a busy-lock manual override refuses launch when its audit cannot be written", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const assertUnchanged = await seedBlockedAudit(setup);
	const result = await run(setup, ["@dev2"]);
	strictEqual(result.status, unavailable);
	strictEqual(result.stdout, "");
	strictEqual(result.stderr, "cc: routing state unavailable\nreturned:1\n");
	await assertUnchanged();
});

await test("seat announcement is one line on stderr before Claude starts", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	await writeFile(setup.binary, "#!/bin/zsh -f\nprint -r -- started >&2\n");
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stdout, "");
	strictEqual(result.stderr, "cc: using main\nstarted\nreturned:0\n");
});

await test("unknown usage refuses safely", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, []);
	strictEqual(result.status, unavailable);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("usage unavailable"));
	const decisions = await lines(setup);
	strictEqual(decisions.length, one);
});

await test("state failures never launch without a claim or audit", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	await mkdir(path.join(setup.directory, "state/claims.json"));
	const result = await run(setup, []);
	strictEqual(result.status, unavailable);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("routing state unavailable"));
});

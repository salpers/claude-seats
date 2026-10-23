import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
	assertRotation,
	cacheFixture,
	probes,
	setupFallback,
	stateDirectory,
} from "./fallback-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, run } from "./shim-fixture.ts";

const success = 0;
const unavailable = 1;
const exhausted = 3;
const two = 2;
const fiveMinutes = 5;
const fifteenMinutes = 15;

await test("endpoint down with five-minute cache routes on numbers and reports their age", async (context: Context): Promise<void> => {
	const setup = await cacheFixture(context, fiveMinutes);
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	ok(result.stderr.includes("(usage cached 5m ago)"));
	assertLaunch(result.stdout, ["unset", ""]);
	const files = await readdir(stateDirectory(setup));
	strictEqual(files.includes("probes.log"), false);
});

await test("absent or fifteen-minute cache probes candidates, persists cooldowns, and rotates across invocations", async (context: Context): Promise<void> => {
	await assertRotation(await setupFallback(context));
	await assertRotation(await cacheFixture(context, fifteenMinutes));
});

const assertRefusal = async (setup: Fixture): Promise<void> => {
	const result = await run(setup, [], {
		env: Object.fromEntries([
			["CLAUDE_SEATS_TEST_LIMIT", "all"],
			["TZ", "Europe/Berlin"],
		]),
	});
	strictEqual(result.status, exhausted);
	strictEqual(result.stdout, "");
	ok(
		result.stderr
			.split("\n")
			.some((line): boolean => line.startsWith("seat  5h")),
	);
	ok(result.stderr.includes("cooldown ↻13:50"));
	ok(result.stderr.includes("cc @<seat>"));
	strictEqual(result.stderr.includes("Project sync"), false);
};
await test("all cooldowns refuse with clocks, table and override hint without launching or syncing", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	await writeFile(
		path.join(setup.home, ".claude.json"),
		"private invalid config",
	);
	await assertRefusal(setup);
	await assertRefusal(setup);
	const calls = await probes(setup);
	deepStrictEqual(calls.toSorted(), ["dev", "dev2", "dev3", "main"]);
	const manual = await run(setup, ["@main"]);
	strictEqual(manual.status, success);
});

await test("expired cooldowns probe again, and simultaneous fallbacks reserve different seats", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	await writeFile(
		path.join(stateDirectory(setup), "fallback.json"),
		JSON.stringify({
			cooldowns: [{ seat: "main", until: 1 }],
			lastSeat: "none",
		}),
	);
	const results = await Promise.all([run(setup, []), run(setup, [])]);
	for (const result of results) {
		strictEqual(result.status, success, result.stderr);
	}
	strictEqual(
		new Set(
			results.map((result: Readonly<{ stderr: string }>) => result.stderr),
		).size,
		two,
	);
	const calls = await probes(setup);
	ok(calls.includes("main"));
});

await test("four-second probes allow concurrent fallback launches to reserve different seats", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	const options = {
		env: Object.fromEntries([["CLAUDE_SEATS_TEST_PROBE_DELAY", "4"]]),
	};
	const results = await Promise.all([
		run(setup, [], options),
		run(setup, [], options),
	]);
	for (const result of results) {
		strictEqual(result.status, success, result.stderr);
	}
	strictEqual(
		new Set(
			results.map((result: Readonly<{ stderr: string }>) => result.stderr),
		).size,
		two,
	);
});

await test("failed probes and corrupt fallback state refuse without leaking diagnostics", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	const failed = await run(setup, [], {
		env: Object.fromEntries([["CLAUDE_SEATS_TEST_PROBE_FAIL", "yes"]]),
	});
	strictEqual(failed.status, unavailable);
	strictEqual(failed.stdout, "");
	strictEqual(failed.stderr.includes("private diagnostic"), false);
	await writeFile(
		path.join(stateDirectory(setup), "fallback.json"),
		"private malformed state",
	);
	const corrupt = await run(setup, []);
	strictEqual(corrupt.status, unavailable);
	ok(corrupt.stderr.includes("routing state unavailable"));
	strictEqual(corrupt.stderr.includes("private malformed"), false);
});

await test("oversized probe output is discarded without granting a launch", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	await writeFile(
		setup.binary,
		`#!/bin/zsh -f
print -rn -- \${(pl:100000::x:)}
`,
	);
	const result = await run(setup, []);
	strictEqual(result.status, unavailable);
	strictEqual(result.stdout, "");
	strictEqual(result.stderr.includes("xxxxxxxx"), false);
});

import { ok, strictEqual } from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { cacheFixture, stateDirectory } from "./fallback-fixture.ts";
import { seedRouting, seedSessions, slotFor } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const usageError = 2;
const minuteMs = 60_000;
const expiredClaimAgeMs = 15_000;
const last = -1;
const one = 1;
const fiveMinutes = 5;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const assertNoProbes = async (setup: Fixture): Promise<void> => {
	const files = await readdir(stateDirectory(setup));
	strictEqual(files.includes("probes.log"), false);
};

await test("a failing seat never triggers probes when healthy usage can rank a launch", async (context: Context): Promise<void> => {
	const setup = await cacheFixture(context, success);
	await rm(path.join(stateDirectory(setup), "usage-dev.json"));
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	await assertNoProbes(setup);
	strictEqual(result.stderr.includes("fallback"), false);
});

await test("fresh and last-good cached ranking with an active cooldown never announces fallback", async (context: Context): Promise<void> => {
	await Promise.all(
		[success, fiveMinutes].map(async (age): Promise<void> => {
			const setup = await cacheFixture(context, age);
			await writeFile(
				path.join(stateDirectory(setup), "fallback.json"),
				JSON.stringify({
					cooldowns: [{ seat: "main", until: Date.now() + minuteMs }],
					lastSeat: "none",
				}),
			);
			const result = await run(setup, []);
			strictEqual(result.status, success, result.stderr);
			ok(result.stderr.includes("cc: using dev"));
			strictEqual(result.stderr.includes("fallback"), false);
			await assertNoProbes(setup);
		}),
	);
});

await test("exhausted logged-in seats and missing credentials refuse as unavailable, not all exhausted", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup, {
		dev: { fiveHour: 100, sevenDay: 1 },
		main: { fiveHour: 100, sevenDay: 1 },
	});
	await Promise.all(
		["dev2", "dev3"].map(async (seat): Promise<void> => {
			await rm(path.join(setup.keychain, `${slotFor(setup, seat)}.json`));
		}),
	);
	const result = await run(setup, []);
	strictEqual(result.status, failure);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("usage unavailable"));
	ok(result.stderr.includes("not logged in"));
	strictEqual(result.stderr.includes("all seats exhausted"), false);
});

const assertClaimsAudit = async (
	setup: Fixture,
	mode: string,
): Promise<void> => {
	const log = await readFile(
		path.join(stateDirectory(setup), "decisions.log"),
		"utf8",
	);
	const decision: unknown = JSON.parse(log);
	ok(isRecord(decision));
	strictEqual(decision["seat"], "none");
	strictEqual(decision["reason"], "claims unavailable");
	strictEqual(decision["mode"], mode);
};
const assertClaimsRefusal = async (
	setup: Fixture,
	text: string,
	{ args, mode }: Readonly<{ args: readonly string[]; mode: string }>,
): Promise<void> => {
	const file = path.join(stateDirectory(setup), "claims.json");
	await writeFile(file, text);
	const result = await run(setup, args);
	strictEqual(result.status, failure);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes(JSON.stringify(file)), result.stderr);
	strictEqual(await readFile(file, "utf8"), text);
	await assertClaimsAudit(setup, mode);
};
await test("corrupt claims refuse automatic and manual launches with an audit and the exact filename", async (context: Context): Promise<void> => {
	await Promise.all(
		[
			"NOT JSON",
			"[null]",
			'[{"seat":"Other","createdAt":0}]',
			'[{"seat":"main","createdAt":"0"}]',
		].flatMap((text) =>
			[
				{ args: [], mode: "auto" },
				{ args: ["@dev2"], mode: "manual" },
			].map(
				async ({
					args,
					mode,
				}: Readonly<{
					args: readonly string[];
					mode: string;
				}>): Promise<void> => {
					const setup = await fixture(context);
					await seedRouting(setup);
					await assertClaimsRefusal(setup, text, { args, mode });
				},
			),
		),
	);
});

await test("an empty fixture override is diagnosed before any credential lookup", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await writeFile(
		path.join(setup.directory, "Claude Code-credentials.json"),
		"",
	);
	const result = await run(setup, ["doctor"], {
		env: Object.fromEntries([["CLAUDE_SEATS_KEYCHAIN_DIR", ""]]),
	});
	strictEqual(result.status, usageError);
	strictEqual(result.stdout, "");
	ok(
		result.stderr.includes(
			"CLAUDE_SEATS_KEYCHAIN_DIR must name a fixture directory or be unset",
		),
	);
});

const assertLiveAudit = async (setup: Fixture): Promise<void> => {
	const log = await readFile(
		path.join(stateDirectory(setup), "decisions.log"),
		"utf8",
	);
	const decision: unknown = JSON.parse(
		log.trimEnd().split("\n").at(last) ?? "null",
	);
	ok(isRecord(decision));
	const { rows } = decision;
	ok(Array.isArray(rows));
	const main: unknown = rows.find(
		(value: unknown) => isRecord(value) && value["seat"] === "main",
	);
	ok(isRecord(main));
	strictEqual(main["live"], one);
	strictEqual(main["claims"], success);
};

const firstLiveSession = async (setup: Fixture): Promise<void> => {
	const first = await run(setup, []);
	strictEqual(first.status, success, first.stderr);
	strictEqual(first.stderr, "cc: using main\nreturned:0\n");
	await seedSessions(setup, "main", [process.pid]);
	await writeFile(
		path.join(stateDirectory(setup), "claims.json"),
		JSON.stringify([
			{ createdAt: Date.now() - expiredClaimAgeMs, seat: "main" },
		]),
	);
};

await test("live key-file sessions keep launches spread after claims expire", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	await firstLiveSession(setup);
	const second = await run(setup, []);
	strictEqual(second.status, success, second.stderr);
	strictEqual(second.stderr, "cc: using dev\nreturned:0\n");
	await assertLiveAudit(setup);
});

await test("partial usage caches rank launches without probing any seat", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup, {
		dev: { fiveHour: 20, sevenDay: "unknown" },
		dev2: { fiveHour: "unknown", sevenDay: 1 },
		dev3: { fiveHour: "unknown", sevenDay: "unknown" },
		main: { fiveHour: 90, sevenDay: "unknown" },
	});
	const binary = await readFile(setup.binary, "utf8");
	await writeFile(
		setup.binary,
		binary.replace(
			"#!/bin/zsh -f\n",
			`#!/bin/zsh -f
if [[ "$1" == -p ]]; then
  print -r -- probed >> "$CLAUDE_SEATS_STATE_DIR/probes.log"
  exit 1
fi
`,
		),
	);
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using dev\nreturned:0\n");
	await assertNoProbes(setup);
});

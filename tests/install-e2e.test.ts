import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { freshShell, installFixture } from "./install-fixture.ts";
import {
	decisions,
	fakeSessionClaude,
	priorContext,
} from "./resume-fixture.ts";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";

const success = 0;
const zero = 0;
const four = 4;
const sessionIds = [
	"11111111-2222-4333-8444-000000000001",
	"11111111-2222-4333-8444-000000000002",
	"11111111-2222-4333-8444-000000000003",
	"11111111-2222-4333-8444-000000000004",
];
const newSessionId = "11111111-2222-4333-8444-000000000005";
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const fourTerminals = async (setup: Fixture): Promise<void> => {
	const results = await Promise.all(
		sessionIds.map(async (id) =>
			freshShell(setup, ["--session-id", id, priorContext]),
		),
	);
	for (const result of results) {
		strictEqual(result.status, success, result.stderr);
		strictEqual(result.stdout, "created\n");
	}
	const entries = await decisions(setup);
	strictEqual(entries.length, four);
	deepStrictEqual(
		new Set(
			entries.map((entry: Readonly<Record<string, unknown>>) => entry["seat"]),
		),
		new Set(["dev", "dev2", "dev3", "main"]),
	);
};

const exhaustedSession = async (setup: Fixture): Promise<string> => {
	const sessions = await Promise.all(
		sessionIds.map(async (id) => {
			const text = await readFile(
				path.join(
					setup.home,
					".claude-shared/projects/fixture-project",
					`${id}.jsonl`,
				),
				"utf8",
			);
			const parsed: unknown = JSON.parse(text);
			ok(isRecord(parsed));
			return { id, origin: parsed["origin"] };
		}),
	);
	const session = sessions.find(
		(entry: Readonly<{ id: string; origin: unknown }>) =>
			entry.origin === ".claude-dev2",
	);
	ok(session);
	return session.id;
};

const assertHandoff = async (setup: Fixture, id: string): Promise<void> => {
	const picker = await freshShell(setup, ["-r"]);
	strictEqual(picker.status, success, picker.stderr);
	ok(picker.stdout.includes(`${id}.jsonl`));
	const resumed = await freshShell(setup, ["-r", id]);
	strictEqual(resumed.status, success, resumed.stderr);
	strictEqual(resumed.stdout, `.claude-dev2: ${priorContext}\n`);
	ok(!resumed.stderr.includes("using dev2"));
};
const assertExclusion = async (setup: Fixture): Promise<void> => {
	const entries = await decisions(setup);
	const afterExhaustion = entries.slice(four);
	ok(afterExhaustion.length > zero);
	for (const entry of afterExhaustion) {
		strictEqual(entry["mode"], "auto");
		ok(entry["seat"] !== "dev2");
	}
	strictEqual(JSON.stringify(entries).includes(priorContext), false);
};

await test("installed cc routes four fresh terminals to four seats, then hands an exhausted seat's context to another", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await writeFile(setup.binary, fakeSessionClaude);
	await seedRouting(setup);
	await fourTerminals(setup);
	const id = await exhaustedSession(setup);
	await seedRouting(setup, { dev2: { fiveHour: 100, sevenDay: 100 } });
	const launched = await freshShell(setup, [
		"--session-id",
		newSessionId,
		"new context",
	]);
	strictEqual(launched.status, success, launched.stderr);
	await assertHandoff(setup, id);
	await assertExclusion(setup);
});

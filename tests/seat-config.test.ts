import { match, strictEqual } from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run } from "./shim-fixture.ts";

const success = 0;
const unavailable = 1;
const usageError = 2;
const configuredSeatsPattern =
	/Use @ to list seats, or @main, @work to launch\./u;
const invalidConfigPattern =
	/seats\.json" must be a readable JSON array of unique seat names/u;

const writeSeats = async (setup: Fixture, text: string): Promise<void> => {
	const shared = path.join(setup.home, ".claude-shared");
	await mkdir(shared, { recursive: true });
	await writeFile(path.join(shared, "seats.json"), text);
};

await test("seats.json renames seats: @work launches its own config directory and @dev becomes unknown", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await writeSeats(setup, '["main", "work"]');
	const launched = await run(setup, ["@work", "--resume", "abc"]);
	strictEqual(launched.status, success, launched.stderr);
	strictEqual(launched.stderr, "cc: using work\nreturned:0\n");
	assertLaunch(launched.stdout, [
		"set",
		path.join(setup.home, ".claude-work"),
		"--resume",
		"abc",
	]);
	const unknown = await run(setup, ["@dev"]);
	strictEqual(unknown.status, usageError);
	match(unknown.stderr, configuredSeatsPattern);
});

await test("an invalid seats.json refuses launches and fails doctor without starting Claude", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await writeSeats(setup, '["main", "../escape"]');
	await Promise.all(
		[[], ["@main"], ["doctor"]].map(
			async (args: readonly string[]): Promise<void> => {
				const result = await run(setup, args);
				strictEqual(result.status, unavailable);
				strictEqual(result.stdout, "");
				match(result.stderr, invalidConfigPattern);
			},
		),
	);
});

import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { readStatuslinePrefix } from "./statusline-command.mjs";

const maximumMs = 2500;
const oversized = 100_000;

await test("legacy deadlines cover pipelines and exited parents with inherited output pipes", async (): Promise<void> => {
	await Promise.all(
		[
			"sleep 3 | cat",
			"sleep 3 & printf 'Opus | repo | git:main | ctx — | a@b'; exit 0",
			"/bin/sh -c 'sleep 3; printf ignored'",
		].map(async (command): Promise<void> => {
			const started = performance.now();
			strictEqual(await readStatuslinePrefix(command, "{}"), "");
			ok(
				performance.now() - started < maximumMs,
				"legacy deadline was not enforced",
			);
		}),
	);
});

await test("legacy output overflow, failed commands and early stdin closure are quiet", async (): Promise<void> => {
	strictEqual(await readStatuslinePrefix("yes x", "{}"), "");
	strictEqual(await readStatuslinePrefix("exit 1", "{}"), "");
	strictEqual(
		await readStatuslinePrefix(
			"printf 'Opus | repo | git:main | ctx — | a@b'",
			"x".repeat(oversized),
		),
		"Opus | repo | git:main | ctx — | ",
	);
});

import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { installFixture } from "./install-fixture.ts";
import { seedRouting } from "./routing-fixture.ts";
import type { Context } from "./shim-fixture.ts";
import { assertLaunch, run } from "./shim-fixture.ts";

const failure = 1;
const success = 0;
await test("doctor warns about inherited auth and provider overrides without printing their values", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	await Promise.all(
		[
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_AUTH_TOKEN",
			"ANTHROPIC_BASE_URL",
			"CLAUDE_CODE_OAUTH_TOKEN",
			"CLAUDE_CODE_USE_BEDROCK",
			"CLAUDE_CODE_USE_VERTEX",
			"CLAUDE_CODE_USE_FOUNDRY",
		].map(async (name): Promise<void> => {
			const result = await run(setup, ["doctor"], {
				env: { [name]: "private override" },
			});
			strictEqual(result.status, failure);
			ok(result.stderr.includes(name));
			ok(result.stderr.includes("seat"));
			strictEqual(
				`${result.stdout}${result.stderr}`.includes("private override"),
				false,
			);
		}),
	);
});

await test("automatic and manual launches warn about inherited auth overrides by name before announcing the seat", async (context: Context): Promise<void> => {
	const names = [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_BASE_URL",
		"CLAUDE_CODE_OAUTH_TOKEN",
		"CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
		"CLAUDE_CODE_USE_BEDROCK",
		"CLAUDE_CODE_USE_VERTEX",
		"CLAUDE_CODE_USE_FOUNDRY",
	];
	await Promise.all(
		[[], ["@main"]].map(async (args: readonly string[]): Promise<void> => {
			const setup = await installFixture(context);
			await seedRouting(setup);
			const result = await run(setup, args, {
				env: Object.fromEntries(
					names.map((name) => [name, "private override"]),
				),
			});
			strictEqual(result.status, success);
			assertLaunch(result.stdout, ["unset", ""]);
			for (const name of names) {
				ok(result.stderr.includes(name));
			}
			ok(result.stderr.includes("Unset them before cc"));
			ok(
				result.stderr.indexOf("Auth/provider environment overrides") <
					result.stderr.indexOf("cc: using main"),
			);
			strictEqual(
				`${result.stdout}${result.stderr}`.includes("private override"),
				false,
			);
		}),
	);
});

await test("empty auth overrides do not warn during launch", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	const result = await run(setup, [], {
		env: Object.fromEntries([
			["ANTHROPIC_API_KEY", ""],
			["CLAUDE_CODE_USE_BEDROCK", ""],
		]),
	});
	strictEqual(result.status, success);
	strictEqual(result.stderr, "cc: using main\nreturned:0\n");
});

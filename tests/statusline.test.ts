import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	copyFile,
	mkdir,
	readFile,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const start = 0;
const failure = 1;
const padding = 1;
const root = path.dirname(import.meta.dirname);
const input =
	'{"fixture_prefix":["Opus","/tmp/日本語 | cwd","feature*","ctx 12%"],"rate_limits":{"five_hour":{"resets_at":1789744800,"used_percentage":10},"seven_day":{"resets_at":1790334000,"used_percentage":1}}}';
const prefix = "Opus | /tmp/日本語 | cwd | feature* | ctx 12% | ";
const suffix = " · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00\n";
const env = Object.fromEntries([["TZ", "Europe/Berlin"]]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const shellQuote = (text: string): string =>
	`'${text.replaceAll("'", String.raw`'\''`)}'`;
const seedCache = async (setup: Fixture): Promise<void> => {
	const state = path.join(setup.directory, "state");
	await mkdir(state, { recursive: true });
	await writeFile(
		path.join(state, "usage-dev3.json"),
		'{"fetchedAt":0,"usage":{"fiveHour":{"resetAt":"2026-09-18T15:20:00.000Z","utilization":10},"sevenDay":{"resetAt":"2026-09-25T11:00:00.000Z","utilization":1}}}',
	);
};
const settingsFile = (setup: Fixture): string =>
	path.join(setup.home, ".claude/settings.json");
const fakeClaude = `#!/bin/zsh -f
exec node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const directory = process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME, ".claude");
const settings = JSON.parse(readFileSync(path.join(directory, "settings.json"), "utf8"));
const result = spawnSync("/bin/sh", ["-c", settings.statusLine.command], { input: readFileSync(0), encoding: "utf8" });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
'
`;

const setupStatusline = async (
	context: Context,
	legacy = true,
): Promise<Fixture> => {
	const setup = await fixture(context);
	await mkdir(path.dirname(settingsFile(setup)), { recursive: true });
	await writeFile(setup.binary, fakeClaude);
	if (legacy) {
		const legacyFile = path.join(setup.directory, "statusline ' $(false).py");
		await copyFile(
			path.join(root, "tests/fixtures/statusline-before.py"),
			legacyFile,
		);
		await writeFile(
			settingsFile(setup),
			JSON.stringify({
				statusLine: {
					command: `python3 ${shellQuote(legacyFile)}`,
					padding,
					type: "command",
				},
			}),
		);
	}
	await mkdir(path.join(setup.home, ".claude-dev3"));
	await symlink(
		settingsFile(setup),
		path.join(setup.home, ".claude-dev3/settings.json"),
	);
	return setup;
};

await test("cc installs and executes the full statusline for dev3 and bare main through shared settings", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await Promise.all(
		["dev3", "main"].map(async (seat): Promise<void> => {
			const rendered = await run(setup, [`@${seat}`], { env, input });
			strictEqual(rendered.status, success, rendered.stderr);
			strictEqual(rendered.stdout, `${prefix}${seat}${suffix}`);
			strictEqual(rendered.stdout.includes("@example.invalid"), false);
		}),
	);
	const before = await stat(settingsFile(setup));
	await run(setup, ["@main"], { env, input });
	const after = await stat(settingsFile(setup));
	strictEqual(after.mtimeMs, before.mtimeMs);
});

await test("the launched statusline uses per-seat router snapshots before the first response", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await seedCache(setup);
	const cached = await run(setup, ["@dev3"], { env, input: "{}" });
	strictEqual(cached.status, success, cached.stderr);
	strictEqual(
		cached.stdout,
		`Sonnet | ~/repo | main* | ctx 12% | dev3${suffix}`,
	);
	const missing = await run(setup, ["@main"], { env, input: "{}" });
	strictEqual(missing.status, success, missing.stderr);
	strictEqual(
		missing.stdout,
		"Sonnet | ~/repo | main* | ctx 12% | main · 5h — · 7d —\n",
	);
});

await test("legacy prefixes survive missing identity with or without live usage", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await seedCache(setup);
	const live = input.replace(
		'{"fixture_prefix"',
		'{"fixture_email":false,"fixture_prefix"',
	);
	const rendered = await run(setup, ["@main"], { env, input: live });
	strictEqual(rendered.status, success, rendered.stderr);
	strictEqual(rendered.stdout, `${prefix}main${suffix}`);
	const cached = await run(setup, ["@dev3"], {
		env,
		input: '{"fixture_email":false}',
	});
	strictEqual(
		cached.stdout,
		`Sonnet | ~/repo | main* | ctx 12% | dev3${suffix}`,
	);
});

await test("installed prefixes survive partial or malformed windows and unrecognized context labels", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	const fixturePrefix = "Opus 5 | nogit | ctx 44.3k/200.0k (22.1%)";
	await Promise.all(
		[
			[fixturePrefix, '{"five_hour":{"used_percentage":10}}', "5h 10% · 7d —"],
			[fixturePrefix, '{"seven_day":{"used_percentage":1}}', "5h — · 7d 1%"],
			[fixturePrefix, '{"five_hour":null}', "5h — · 7d —"],
			[fixturePrefix, '{"five_hour":[1,2]}', "5h — · 7d —"],
			[fixturePrefix, "{}", "5h — · 7d —"],
			["Opus | cwd | git", "{}", "5h — · 7d —"],
			["Opus | cwd | git | 70% ctx", "{}", "5h — · 7d —"],
			["Opus | cwd | git | ctx:5%", "{}", "5h — · 7d —"],
			["Opus | 日本語 | git | ◔ 70%", "{}", "5h — · 7d —"],
		].map(
			async ([before, limits, expected]: readonly string[]): Promise<void> => {
				const rendered = await run(setup, ["@main"], {
					env,
					input: `{"fixture_prefix":${JSON.stringify((before ?? "").split(" | "))},"rate_limits":${limits}}`,
				});
				strictEqual(rendered.status, success, rendered.stderr);
				strictEqual(rendered.stdout, `${before} | main · ${expected}\n`);
			},
		),
	);
});

await test("displayName-only accounts keep the installed prefix for live usage and cached startup", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await seedCache(setup);
	const account = '"fixture_account":{"displayName":"Sebastian"},';
	const live = input.replace(
		'{"fixture_prefix"',
		`{${account}"fixture_prefix"`,
	);
	await Promise.all(
		["main", "dev3"].map(async (seat): Promise<void> => {
			const rendered = await run(setup, [`@${seat}`], { env, input: live });
			strictEqual(rendered.status, success, rendered.stderr);
			strictEqual(rendered.stdout, `${prefix}${seat}${suffix}`);
		}),
	);
	const cached = await run(setup, ["@dev3"], {
		env,
		input: `{${account}"fixture_prefix":["Opus 5","repo","ctx 12%"]}`,
	});
	strictEqual(cached.status, success, cached.stderr);
	strictEqual(cached.stdout, `Opus 5 | repo | ctx 12% | dev3${suffix}`);
});

await test("a fresh setup gets a runnable statusline and malformed input is quiet", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context, false);
	const rendered = await run(setup, ["@main"], { env, input });
	strictEqual(rendered.status, success, rendered.stderr);
	strictEqual(rendered.stdout, `main${suffix}`);
	const malformed = await run(setup, ["@main"], {
		env,
		input: "private invalid input",
	});
	strictEqual(malformed.stdout, "main · 5h — · 7d —\n");
	strictEqual(malformed.stderr, "cc: using main\nreturned:0\n");
});

await test("invalid statusLine settings refuse launch without replacing the prior command", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await writeFile(
		settingsFile(setup),
		'{ "autoContinueAtUsageLimit": false, "statusLine": { "command": 42 } }',
	);
	const before = await readFile(settingsFile(setup), "utf8");
	const result = await run(setup, ["@main"], { env, input });
	strictEqual(result.status, failure);
	ok(result.stderr.includes("Cannot configure statusLine"));
	strictEqual(await readFile(settingsFile(setup), "utf8"), before);
});

await test("settings retain padding and the legacy command after installation", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await run(setup, ["@main"], { env, input });
	const parsed: unknown = JSON.parse(
		await readFile(settingsFile(setup), "utf8"),
	);
	ok(isRecord(parsed));
	const { statusLine } = parsed;
	ok(isRecord(statusLine));
	deepStrictEqual(Object.keys(statusLine).toSorted(), [
		"command",
		"padding",
		"type",
	]);
	strictEqual(statusLine["padding"], padding);
});

const seedOldStatusline = async (setup: Fixture): Promise<void> => {
	const parsed: unknown = JSON.parse(
		await readFile(settingsFile(setup), "utf8"),
	);
	ok(isRecord(parsed));
	const { statusLine } = parsed;
	ok(isRecord(statusLine));
	const legacy = statusLine["command"];
	ok(typeof legacy === "string");
	const oldCommand = `${shellQuote(path.join(setup.directory, "removed node/bin/node"))} ${shellQuote(path.join(root, "src/statusline-cli.ts"))}`;
	await writeFile(
		settingsFile(setup),
		JSON.stringify({
			...parsed,
			statusLine: {
				...statusLine,
				command: `${oldCommand} --legacy-command ${shellQuote(legacy)}`,
			},
		}),
	);
};

await test("a Node upgrade keeps the legacy prefix runnable after the old executable is removed", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await seedOldStatusline(setup);
	const rendered = await run(setup, ["@dev3"], { env, input });
	strictEqual(rendered.status, success, rendered.stderr);
	strictEqual(rendered.stdout, `${prefix}dev3${suffix}`);
	strictEqual(rendered.stderr, "cc: using dev3\nreturned:0\n");
});

await test("the real legacy Python output and installed renderer have byte-identical prefixes", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	const before = await run(
		setup,
		[path.join(root, "tests/fixtures/statusline-before.py")],
		{ env, input, script: 'shift; exec python3 "$@"' },
	);
	strictEqual(before.status, success, before.stderr);
	const after = await run(setup, ["@dev3"], { env, input });
	strictEqual(after.status, success, after.stderr);
	const oldPrefix = Buffer.from(
		before.stdout.slice(start, before.stdout.indexOf("sess ")),
	);
	deepStrictEqual(
		Buffer.from(after.stdout).subarray(start, oldPrefix.length),
		oldPrefix,
	);
	ok(before.stdout.includes("person@example.invalid"));
	strictEqual(after.stdout.includes("person@example.invalid"), false);
});

await test("legacy command failures discard stderr and still render the seat segment", async (context: Context): Promise<void> => {
	const setup = await setupStatusline(context);
	await writeFile(
		settingsFile(setup),
		JSON.stringify({
			statusLine: {
				command: "printf 'private diagnostic' >&2; exit 1",
				type: "command",
			},
		}),
	);
	const result = await run(setup, ["@main"], { env, input });
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stdout, `main${suffix}`);
	strictEqual(result.stderr, "cc: using main\nreturned:0\n");
});

import { match, ok, strictEqual } from "node:assert/strict";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run, shell } from "./shim-fixture.ts";

const success = 0;
const usageError = 2;
const next = 1;
const rowCount = 5;
const validSeatsPattern = /@main, @dev, @dev2, @dev3/u;
const returnedErrorPattern = /returned:2/u;
const absentSlotPattern =
	/\? +\? \(not logged in\) +0 +no .+Claude Code-credentials-[\da-f]{8}$/u;
const presentSlotPattern =
	/\? +\? \(invalid credential\) +0 +yes .+Claude Code-credentials$/u;
const unknownCredentialPattern =
	/\? +\? \(credential unavailable\) +0 +unknown /u;
const missingNode = 1;
const executableMode = 0o700;

const stubCompiler = async (setup: Fixture): Promise<void> => {
	const compiler = path.join(setup.directory, "bin/cc");
	await writeFile(compiler, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
	await chmod(compiler, executableMode);
};
const assertExternalCompiler = async (
	setup: Fixture,
	args: readonly string[],
	expected: string,
): Promise<void> => {
	const before = await run(setup, args, { script: 'shift; cc "$@"' });
	strictEqual(before.status, success, before.stderr);
	strictEqual(before.stdout, expected);
};

await test("the sourced function shadows external cc while command cc and child scripts keep compiler arguments", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await stubCompiler(setup);
	const args = ["-o", "output with spaces", "source.c"];
	const expected = `${args.join("\n")}\n`;
	await assertExternalCompiler(setup, args, expected);
	const after = await run(setup, args, {
		script: `source "$1"; shift; whence -w cc; command cc "$@"; /bin/zsh -f -c 'cc "$@"' cc-test "$@"`,
	});
	strictEqual(after.status, success, after.stderr);
	strictEqual(after.stdout, `cc: function\n${expected}${expected}`);
	strictEqual(after.stderr, "");
});

await test("@dev2 launches Claude from any cwd with resume arguments and the overridden seat directory", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@dev2", "--resume", "abc"]);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using dev2\nreturned:0\n");
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev2"),
		"--resume",
		"abc",
	]);
});

await test("@main removes an inherited config override and preserves every argument literally", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const args = [
		"--",
		"@dev3",
		"",
		"a b",
		"'quotes'",
		'"double"',
		"$(false)",
		"`false`",
		"*",
		"line\nbreak",
		"trailing\n",
	];
	const result = await run(setup, ["@main", ...args]);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using main\nreturned:0\n");
	assertLaunch(result.stdout, ["unset", "", ...args]);
});

await test("all named seats launch without querying credentials, including when the fixture directory is missing", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await Promise.all(
		["dev", "dev2", "dev3"].map(async (name): Promise<void> => {
			const result = await run(setup, [`@${name}`, "auth", "status"], {
				env: Object.fromEntries([
					["CLAUDE_SEATS_KEYCHAIN_DIR", path.join(setup.directory, "missing")],
				]),
			});
			strictEqual(result.status, success, result.stderr);
			assertLaunch(result.stdout, [
				"set",
				path.join(setup.home, `.claude-${name}`),
				"auth",
				"status",
			]);
		}),
	);
});

await test("unknown and api seats return 2 with valid names and never start Claude", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await Promise.all(
		[["@unknown"], ["@api"], ["@", "extra"]].map(
			async (args: readonly string[]): Promise<void> => {
				const result = await run(setup, args);
				strictEqual(result.status, usageError);
				strictEqual(result.stdout, "");
				match(result.stderr, validSeatsPattern);
				match(result.stderr, returnedErrorPattern);
			},
		),
	);
});

const assertRow = (setup: Fixture, row: string, name: string): void => {
	let directory = `.claude-${name}`;
	let slot = absentSlotPattern;
	if (name === "main") {
		directory = ".claude";
		slot = presentSlotPattern;
	}
	ok(row.startsWith(`${name} `));
	// A control character in HOME keeps the cell quoted so the row cannot break.
	const quotedDirectory = JSON.stringify(path.join(setup.home, directory));
	ok(row.includes(`${quotedDirectory} `));
	match(row, slot);
};

const assertTable = (setup: Fixture, stdout: string): void => {
	const [header, ...rows] = stdout.trimEnd().split("\n");
	strictEqual(rows.length + next, rowCount);
	const headerLine = header ?? "";
	ok(headerLine.startsWith("seat  5h  7d"));
	ok(headerLine.includes("live  credential  directory"));
	ok(headerLine.endsWith("keychain slot"));
	const names = ["main", "dev", "dev2", "dev3"];
	for (const [index, row] of rows.entries()) {
		assertRow(setup, row, names[index] ?? "");
	}
};

await test("listing has four rows with slots and fixture presence, excludes api, and returns to the shell", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await writeFile(
		path.join(setup.keychain, "Claude Code-credentials.json"),
		"{}",
	);
	await mkdir(path.join(setup.home, ".claude-api"));
	const result = await run(setup, ["@"]);
	strictEqual(result.status, success, result.stderr);
	assertTable(setup, result.stdout);
	strictEqual(result.stdout.includes(".claude-api"), false);
	strictEqual(result.stderr, "returned:0\n");
});

await test("default home and PATH binary resolution work, and -- prevents selector parsing", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	const result = await run(setup, ["--", "@dev2"], {
		omit: ["CLAUDE_SEATS_CLAUDE_BIN", "CLAUDE_SEATS_HOME"],
	});
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, ["unset", "", "--", "@dev2"]);
	const dev = await run(setup, ["@dev", "prompt"], {
		omit: ["CLAUDE_SEATS_CLAUDE_BIN", "CLAUDE_SEATS_HOME"],
	});
	strictEqual(dev.status, success, dev.stderr);
	assertLaunch(dev.stdout, [
		"set",
		path.join(setup.home, ".claude-dev"),
		"prompt",
	]);
});

await test("the session's exit status propagates to the caller", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const expected = 37;
	const result = await run(setup, ["@main", "prompt"], {
		env: Object.fromEntries([["CLAUDE_SEATS_TEST_EXIT", String(expected)]]),
	});
	strictEqual(result.status, expected);
	strictEqual(result.stderr, "cc: using main\nreturned:37\n");
});

await test("@main launches with zero Claude arguments", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@main"]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, ["unset", ""]);
});

await test("the home override isolates @main even when the caller has a different HOME", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@main"], {
		env: Object.fromEntries([
			["CLAUDE_SEATS_TEST_HOME", "yes"],
			["HOME", path.join(setup.directory, "caller-home")],
		]),
	});
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, ["unset", "", setup.home]);
});

await test("the shim can be sourced through a symlink with spaces", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const shim = path.join(setup.directory, "linked cc.zsh");
	await symlink(setup.shim, shim);
	const result = await run({ ...setup, shim }, ["@dev2", "--resume", "abc"]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev2"),
		"--resume",
		"abc",
	]);
});

await test("the launch inherits stdin, stdout, and stderr", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await writeFile(
		setup.binary,
		"#!/bin/zsh -f\ncat\nprint -r -- child-stderr >&2\n",
	);
	const result = await run(setup, ["@dev2"], { input: "caller stdin\n" });
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stdout, "caller stdin\n");
	strictEqual(result.stderr, "cc: using dev2\nchild-stderr\nreturned:0\n");
});

await test("a failed Node invocation returns without starting Claude", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await rm(path.join(setup.directory, "bin/node"));
	const result = await run(setup, ["@dev2"], {
		env: Object.fromEntries([["PATH", path.join(setup.directory, "bin")]]),
	});
	strictEqual(result.status, missingNode);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("put Node 24 or newer on PATH"));
	ok(result.stderr.includes("returned:1"));
});

await test("a readonly inherited config fails safely instead of leaking into @main", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@main"], {
		script: `readonly CLAUDE_CONFIG_DIR; ${shell}`,
	});
	ok(result.status !== success);
	strictEqual(result.stdout, "");
});

await test("empty home or binary overrides return usage errors without launching", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await Promise.all(
		["CLAUDE_SEATS_HOME", "CLAUDE_SEATS_CLAUDE_BIN"].map(
			async (key): Promise<void> => {
				const result = await run(setup, ["@dev2"], {
					env: Object.fromEntries([[key, ""]]),
				});
				strictEqual(result.status, usageError);
				strictEqual(result.stdout, "");
			},
		),
	);
});

await test("credential access failures show unknown without discarding the table", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const file = path.join(setup.directory, "not-a-directory");
	await writeFile(file, "{}");
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_KEYCHAIN_DIR", file]]),
	});
	strictEqual(result.status, success);
	const [, ...rows] = result.stdout.trimEnd().split("\n");
	strictEqual(rows.length + next, rowCount);
	for (const row of rows) {
		match(row, unknownCredentialPattern);
	}
	ok(result.stderr.includes("Credential presence unavailable"));
});

import { strictEqual } from "node:assert/strict";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const missingBinary = 127;
const nonExecutableMode = 0o600;
const survive = `source "$1" || exit; shift
cc "$@"
result=$?
print -r -- "survived:$result"
printf '%s\\0' "$HOME" "\${CLAUDE_CONFIG_DIR-unset}"
`;

const assertRefusedLaunch = async (
	setup: Fixture,
	binary?: string,
): Promise<void> => {
	const callerHome = path.join(setup.directory, "caller-home");
	await Promise.all(
		["@main", "@dev2"].flatMap((seat) =>
			["/caller/exported/config", "unset"].map(
				async (config): Promise<void> => {
					const env = Object.fromEntries([
						["HOME", callerHome],
						["PATH", path.join(setup.directory, "bin")],
					]);
					if (typeof binary === "string") {
						env["CLAUDE_SEATS_CLAUDE_BIN"] = binary;
					}
					const omit = ["CLAUDE_SEATS_CLAUDE_BIN"];
					if (config === "unset") {
						omit.push("CLAUDE_CONFIG_DIR");
					}
					const result = await run(setup, [seat], {
						env,
						omit,
						script: survive,
					});
					strictEqual(result.status, success, result.stderr);
					strictEqual(
						result.stdout,
						`survived:${missingBinary}\n${callerHome}\0${config}\0`,
					);
					strictEqual(
						result.stderr,
						"cc: claude binary not found or not executable\n",
					);
				},
			),
		),
	);
};

await test("a missing Claude override returns to the shell without changing its environment", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await assertRefusedLaunch(setup, path.join(setup.directory, "missing"));
});

await test("a missing Claude on PATH returns to the shell without changing its environment", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await rm(path.join(setup.directory, "bin/claude"));
	await assertRefusedLaunch(setup);
});

await test("a non-executable Claude override returns to the shell without changing its environment", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await chmod(setup.binary, nonExecutableMode);
	await assertRefusedLaunch(setup, setup.binary);
});

await test("a directory Claude override returns to the shell without changing its environment", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await assertRefusedLaunch(setup, setup.directory);
});

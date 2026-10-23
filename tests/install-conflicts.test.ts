import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	readlink,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Context } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const privateMode = 0o700;
const lockedMode = 0o500;

await test("install refuses a symlinked settings hub and leaves its target untouched", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const target = path.join(setup.directory, "other-settings.json");
	await writeFile(target, "{}");
	await mkdir(path.join(setup.home, ".claude"));
	await symlink(target, path.join(setup.home, ".claude/settings.json"));
	const result = await run(setup, ["install"]);
	strictEqual(result.status, failure);
	ok(result.stderr.includes("Cannot safely configure hub settings.json"));
	strictEqual(await readFile(target, "utf8"), "{}");
	deepStrictEqual(await readdir(setup.home), [".claude"]);
});

await test("an unwritable installation reports a safe error and can be retried", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await chmod(setup.home, lockedMode);
	const refused = await run(setup, ["install"]);
	await chmod(setup.home, privateMode);
	strictEqual(refused.status, failure);
	ok(refused.stderr.includes("check permissions"), refused.stderr);
	const installed = await run(setup, ["install"]);
	strictEqual(installed.status, success, installed.stderr);
});

await test("relative home overrides install links with absolute targets", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const env = Object.fromEntries([
		["CLAUDE_SEATS_HOME", path.relative(setup.directory, setup.home)],
	]);
	const result = await run(setup, ["install"], { env });
	strictEqual(result.status, success, result.stderr);
	const target = await readlink(path.join(setup.home, ".claude/projects"));
	ok(path.isAbsolute(target));
});

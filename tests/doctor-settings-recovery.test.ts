import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { lstat, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { freshShell, installFixture } from "./install-fixture.ts";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const settingsFile = (setup: Fixture): string =>
	path.join(setup.home, ".claude/settings.json");

interface FileSnapshot {
	readonly contents: string;
	readonly ino: number;
	readonly mode: number;
	readonly mtimeMs: number;
}
const fileSnapshot = async (file: string): Promise<FileSnapshot> => {
	const info = await lstat(file);
	return {
		contents: await readFile(file, "utf8"),
		ino: info.ino,
		mode: info.mode,
		mtimeMs: info.mtimeMs,
	};
};
const assertInstall = async (
	setup: Fixture,
	expected: number,
): Promise<void> => {
	const result = await freshShell(setup, ["install"]);
	strictEqual(result.status, expected, result.stderr);
};
const reinstallAndCheck = async (setup: Fixture): Promise<void> => {
	await assertInstall(setup, success);
	const healthy = await freshShell(setup, ["doctor"]);
	strictEqual(healthy.status, success, healthy.stderr);
};
const assertDiagnosis = async (
	setup: Fixture,
	remedy: string,
): Promise<void> => {
	const result = await freshShell(setup, ["doctor"]);
	strictEqual(result.status, failure);
	ok(result.stderr.includes(remedy), result.stderr);
	strictEqual(result.stderr.includes("private invalid settings"), false);
};
const assertRefusalPreservesFiles = async (
	setup: Fixture,
	files: readonly string[],
	remedy: string,
): Promise<void> => {
	const before = await Promise.all(
		files.map(async (file) => fileSnapshot(file)),
	);
	await assertDiagnosis(setup, remedy);
	await assertInstall(setup, failure);
	deepStrictEqual(
		await Promise.all(files.map(async (file) => fileSnapshot(file))),
		before,
	);
};

await Promise.all(
	[
		{
			remedy: "fix its contents before running cc install",
			text: "{private invalid settings",
		},
		{
			remedy: "repair or remove the statusLine field before running cc install",
			text: '{"statusLine":{"command":42}}',
		},
	].map(
		async ({
			text,
			remedy,
		}: Readonly<{ text: string; remedy: string }>): Promise<void> => {
			await test(`doctor names a working recovery step: ${remedy}`, async (context: Context): Promise<void> => {
				const setup = await installFixture(context);
				await seedRouting(setup);
				const settings = settingsFile(setup);
				await writeFile(settings, text);
				await assertRefusalPreservesFiles(setup, [settings], remedy);
				await writeFile(settings, '{"permissions":{"allow":["Read"]}}');
				await reinstallAndCheck(setup);
				const repaired = await readFile(settings, "utf8");
				ok(repaired.includes('"permissions":{"allow":["Read"]}'));
			});
		},
	),
);

const linkSettings = async (
	setup: Fixture,
): Promise<Readonly<{ original: string; target: string }>> => {
	const settings = settingsFile(setup);
	const original = await readFile(settings, "utf8");
	const target = path.join(setup.directory, "other-settings.json");
	await writeFile(target, original);
	await rm(settings);
	await symlink(target, settings);
	return { original, target };
};

await test("doctor requires a regular hub file before reinstalling and leaves a symlink target untouched", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	const settings = settingsFile(setup);
	const { original, target } = await linkSettings(setup);
	await assertRefusalPreservesFiles(
		setup,
		[settings, target],
		"regular UTF-8 file (not a symlink), then run cc install",
	);
	await rm(settings);
	await writeFile(settings, original);
	await reinstallAndCheck(setup);
	strictEqual(await readFile(target, "utf8"), original);
});

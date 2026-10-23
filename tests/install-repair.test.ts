import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import {
	lstat,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { freshShell, installFixture } from "./install-fixture.ts";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const directories = [".claude", ".claude-dev", ".claude-dev2", ".claude-dev3"];

const linkSnapshots = async (
	files: readonly string[],
): Promise<readonly Readonly<{ ino: number; target: string }>[]> =>
	Promise.all(
		files.map(async (file) => {
			const info = await lstat(file);
			return { ino: info.ino, target: await readlink(file) };
		}),
	);

const assertDoctor = async (setup: Fixture, status: number): Promise<void> => {
	const result = await freshShell(setup, ["doctor"]);
	strictEqual(result.status, status, result.stderr);
};

const assertTargets = async (
	links: readonly string[],
	target: string,
): Promise<void> => {
	const actual = await Promise.all(links.map(async (link) => realpath(link)));
	const expected = await realpath(target);
	deepStrictEqual(
		actual,
		links.map(() => expected),
	);
};

const assertRepair = async (
	setup: Fixture,
	target: string,
	links: readonly string[],
): Promise<void> => {
	const before = await linkSnapshots(links);
	await rm(target, { recursive: true });
	await assertDoctor(setup, failure);
	const installed = await freshShell(setup, ["install"]);
	strictEqual(installed.status, success, installed.stderr);
	deepStrictEqual(await linkSnapshots(links), before);
	await assertTargets(links, target);
	await assertDoctor(setup, success);
};

await test("install recreates missing hub settings without replacing the seats' correct links", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	await assertRepair(
		setup,
		path.join(setup.home, ".claude/settings.json"),
		[".claude-dev", ".claude-dev2", ".claude-dev3"].map((directory) =>
			path.join(setup.home, directory, "settings.json"),
		),
	);
});

await Promise.all(
	["projects", "history.jsonl"].map(async (entry): Promise<void> => {
		await test(`install recreates missing shared ${entry} behind correct absolute and relative links`, async (context: Context): Promise<void> => {
			const setup = await installFixture(context);
			await seedRouting(setup);
			const links = directories.map((directory) =>
				path.join(setup.home, directory, entry),
			);
			const relativeLink = path.join(setup.home, ".claude-dev", entry);
			await rm(relativeLink);
			await symlink(`../.claude-shared/${entry}`, relativeLink);
			await assertRepair(
				setup,
				path.join(setup.home, ".claude-shared", entry),
				links,
			);
		});
	}),
);

const brokenProjectLink = async (
	setup: Fixture,
	target: string,
): Promise<string> => {
	const link = path.join(setup.home, ".claude-dev/projects");
	await rm(path.join(setup.home, ".claude-shared/projects"), {
		recursive: true,
	});
	await rm(link);
	await symlink(target, link);
	return link;
};

await Promise.all(
	["../wrong-projects", "../missing/../.claude-shared/projects"].map(
		async (target): Promise<void> => {
			await test(`install refuses the dangling target ${target} without changes even when the expected target is missing`, async (context: Context): Promise<void> => {
				const setup = await installFixture(context);
				const settings = path.join(setup.home, ".claude/settings.json");
				const before = await readFile(settings, "utf8");
				const link = await brokenProjectLink(setup, target);
				const refused = await freshShell(setup, ["install"]);
				strictEqual(refused.status, failure);
				ok(refused.stderr.includes("dev: projects"), refused.stderr);
				strictEqual(await readlink(link), target);
				strictEqual(await readFile(settings, "utf8"), before);
				await rejects(lstat(path.join(setup.home, ".claude-shared/projects")), {
					code: "ENOENT",
				});
			});
		},
	),
);

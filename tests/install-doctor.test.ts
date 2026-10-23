import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
	freshShell,
	installedShim,
	installFixture,
} from "./install-fixture.ts";
import { seedRouting, slotFor } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const modeBase = 0o1000;
const octal = 8;
const privateMode = 0o700;
const publicMode = 0o755;
const lockedMode = 0o500;
const names = ["main", "dev", "dev2", "dev3"];
const directories = [".claude", ".claude-dev", ".claude-dev2", ".claude-dev3"];

const assertLink = async (file: string, target: string): Promise<void> => {
	const info = await lstat(file);
	ok(info.isSymbolicLink());
	strictEqual(await realpath(file), await realpath(target));
};
const assertMode = async (file: string, mode: number): Promise<void> => {
	const info = await stat(file);
	strictEqual(info.mode % modeBase, mode);
};
const assertLayout = async (setup: Fixture): Promise<void> => {
	await assertLink(installedShim(setup), setup.shim);
	await Promise.all(
		directories.map(async (directory): Promise<void> => {
			await Promise.all(
				[
					"projects",
					"history.jsonl",
					"file-history",
					"shell-snapshots",
					"tasks",
				].map(async (entry): Promise<void> => {
					await assertLink(
						path.join(setup.home, directory, entry),
						path.join(setup.home, ".claude-shared", entry),
					);
				}),
			);
			if (directory !== ".claude") {
				await assertLink(
					path.join(setup.home, directory, "settings.json"),
					path.join(setup.home, ".claude/settings.json"),
				);
			}
		}),
	);
};
const assertDoctorFailure = async (
	setup: Fixture,
	diagnostic: string,
): Promise<void> => {
	const result = await freshShell(setup, ["doctor"]);
	strictEqual(result.status, failure);
	ok(result.stderr.includes(diagnostic), result.stderr);
	strictEqual(result.stderr.includes("private invalid"), false);
};
const assertHealthy = async (setup: Fixture): Promise<void> => {
	const result = await freshShell(setup, ["doctor"]);
	strictEqual(result.status, success, result.stderr);
	ok(result.stdout.includes("Setup is healthy"));
};

await test("install links the checkout and shared layout; a fresh terminal lists seats and passes doctor", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	await assertLayout(setup);
	const table = await freshShell(setup, ["@"]);
	strictEqual(table.status, success, table.stderr);
	const lines = table.stdout.split("\n");
	for (const name of names) {
		ok(lines.some((line): boolean => line.startsWith(`${name} `)));
	}
	await assertHealthy(setup);
	await assertMode(path.join(setup.directory, "state"), privateMode);
});

const untouched = [
	".claude.json",
	".claude-api/keep",
	".claude-dev/.claude.json",
	".claude-shared/projects/context.jsonl",
];
const seedExisting = async (setup: Fixture): Promise<void> => {
	await mkdir(path.join(setup.home, ".claude"));
	await writeFile(
		path.join(setup.home, ".claude/settings.json"),
		JSON.stringify({
			permissions: { allow: ["Read"] },
			statusLine: { command: "printf legacy", padding: 2, type: "command" },
		}),
	);
	await Promise.all(
		untouched.map(async (file): Promise<void> => {
			await mkdir(path.dirname(path.join(setup.home, file)), {
				recursive: true,
			});
			await writeFile(path.join(setup.home, file), "preserve me");
		}),
	);
};
const assertIdempotent = async (setup: Fixture): Promise<void> => {
	const settings = path.join(setup.home, ".claude/settings.json");
	const before = await readFile(settings, "utf8");
	const beforeStat = await stat(settings);
	const result = await run(setup, ["install"]);
	strictEqual(result.status, success, result.stderr);
	const afterStat = await stat(settings);
	strictEqual(await readFile(settings, "utf8"), before);
	strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs);
	ok(before.includes('"permissions":{"allow":["Read"]}'));
	ok(before.includes("--legacy-command"));
};
await test("install is idempotent and preserves settings, local identity, transcripts, and api config", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedExisting(setup);
	const result = await run(setup, ["install"]);
	strictEqual(result.status, success, result.stderr);
	await assertIdempotent(setup);
	await Promise.all(
		untouched.map(async (file): Promise<void> => {
			strictEqual(
				await readFile(path.join(setup.home, file), "utf8"),
				"preserve me",
			);
		}),
	);
});

const breakLink = async (
	setup: Fixture,
	file: string,
	kind: string,
): Promise<void> => {
	if (kind === "wrong") {
		await symlink(setup.home, file);
	} else if (kind === "dangling") {
		await symlink(path.join(setup.home, "absent"), file);
	} else if (kind === "directory") {
		await mkdir(file);
	}
};

await Promise.all(
	["missing", "wrong", "dangling", "directory"].map(
		async (kind): Promise<void> => {
			await test(`doctor reports a ${kind} shared link without repairing it`, async (context: Context): Promise<void> => {
				const setup = await installFixture(context);
				await seedRouting(setup);
				const file = path.join(setup.home, ".claude-dev/projects");
				await rm(file);
				await breakLink(setup, file, kind);
				await assertDoctorFailure(setup, "dev: projects must be a symlink");
				const installed = await run(setup, ["install"]);
				if (kind === "missing") {
					strictEqual(installed.status, success, installed.stderr);
				} else {
					strictEqual(installed.status, failure);
				}
			});
		},
	),
);

await Promise.all(
	names.map(async (name): Promise<void> => {
		await test(`doctor diagnoses ${name}'s missing keychain slot and never reads its contents`, async (context: Context): Promise<void> => {
			const setup = await installFixture(context);
			await seedRouting(setup);
			const file = path.join(setup.keychain, `${slotFor(setup, name)}.json`);
			await rm(file);
			await assertDoctorFailure(setup, `${name}: keychain slot missing`);
			await writeFile(file, "private invalid credential contents");
			await assertHealthy(setup);
		});
	}),
);

await Promise.all(
	[publicMode, lockedMode].map(async (mode): Promise<void> => {
		await test(`doctor rejects state permissions ${mode.toString(octal)} without changing them`, async (context: Context): Promise<void> => {
			const setup = await installFixture(context);
			await seedRouting(setup);
			const state = path.join(setup.directory, "state");
			await chmod(state, mode);
			await assertDoctorFailure(setup, "state directory");
			await assertMode(state, mode);
			await chmod(state, privateMode);
		});
	}),
);

const invalidSettings = [
	"private invalid settings",
	JSON.stringify({ autoContinueAtUsageLimit: false }),
	JSON.stringify({
		autoContinueAtUsageLimit: false,
		statusLine: { command: "echo private", type: "command" },
	}),
];
await Promise.all(
	invalidSettings.map(async (text, index): Promise<void> => {
		await test(`doctor rejects missing or invalid statusline wiring (${index}) without editing settings`, async (context: Context): Promise<void> => {
			const setup = await installFixture(context);
			await seedRouting(setup);
			const settings = path.join(setup.home, ".claude/settings.json");
			await writeFile(settings, text);
			await assertDoctorFailure(setup, "statusLine");
			strictEqual(await readFile(settings, "utf8"), text);
		});
	}),
);

await test("install refuses existing unshared transcripts without overwriting them", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const projects = path.join(setup.home, ".claude-dev/projects");
	await mkdir(projects, { recursive: true });
	await writeFile(path.join(projects, "context.jsonl"), "preserved context");
	const result = await run(setup, ["install"]);
	strictEqual(result.status, failure);
	ok(result.stderr.includes("dev: projects"), result.stderr);
	strictEqual(
		await readFile(path.join(projects, "context.jsonl"), "utf8"),
		"preserved context",
	);
	deepStrictEqual(await readdir(setup.home), [".claude-dev"]);
});

await test("doctor on an uninstalled home reports every missing config dir without creating files", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["doctor"]);
	strictEqual(result.status, failure);
	for (const name of names) {
		ok(result.stderr.includes(`${name}: config directory`));
	}
	deepStrictEqual(await readdir(setup.home), []);
});

await test("install and doctor honor the default home and state directory without manual scaffolding", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const omit = ["CLAUDE_SEATS_HOME", "CLAUDE_SEATS_STATE_DIR"];
	const installed = await run(setup, ["install"], { omit });
	strictEqual(installed.status, success, installed.stderr);
	await seedRouting(setup);
	const result = await run(setup, ["doctor"], { omit });
	strictEqual(result.status, success, result.stderr);
	await assertMode(path.join(setup.home, ".claude-shared/_seats"), privateMode);
});

await test("doctor accepts relative links and reports missing hub settings links", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	const file = path.join(setup.home, ".claude-dev/settings.json");
	await rm(file);
	await assertDoctorFailure(setup, "dev: settings.json must be a symlink");
	await symlink("../.claude/settings.json", file);
	await assertHealthy(setup);
});

await test("doctor reports an absent installed shim when invoked from the checkout", async (context: Context): Promise<void> => {
	const setup = await installFixture(context);
	await seedRouting(setup);
	await rm(installedShim(setup));
	const result = await run(setup, ["doctor"]);
	strictEqual(result.status, failure);
	ok(
		result.stderr.includes("installed cc.zsh must be a symlink"),
		result.stderr,
	);
});

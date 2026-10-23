import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { setupFallback } from "./fallback-fixture.ts";
import {
	assertDecision,
	decisions,
	priorContext,
	sessionFixture,
	sessionId,
	settingsFile,
} from "./resume-fixture.ts";
import { seedRouting } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { assertLaunch, fixture, run } from "./shim-fixture.ts";

const success = 0;
const unavailable = 1;
const exhausted = 3;
const full = { fiveHour: 100, sevenDay: 100 };
const lessHeadroom = { fiveHour: 10, sevenDay: 80 };
const modeBase = 0o1000;
const privateMode = 0o600;

const assertFailFastSettings = async (setup: Fixture): Promise<void> => {
	const settings: unknown = JSON.parse(
		await readFile(settingsFile(setup), "utf8"),
	);
	ok(
		typeof settings === "object" &&
			settings !== null &&
			"autoContinueAtUsageLimit" in settings,
	);
	strictEqual(settings.autoContinueAtUsageLimit, false);
	deepStrictEqual(Object.keys(settings).toSorted(), [
		"autoContinueAtUsageLimit",
		"statusLine",
	]);
};

await test("cc -r opens a routed picker that discovers a session created on dev2 through the shared store", async (context: Context): Promise<void> => {
	const setup = await sessionFixture(context);
	await seedRouting(setup, {
		dev: lessHeadroom,
		dev2: lessHeadroom,
		main: lessHeadroom,
	});
	const picker = await run(setup, ["-r"]);
	strictEqual(picker.status, success, picker.stderr);
	strictEqual(picker.stderr, "cc: using dev3\nreturned:0\n");
	strictEqual(picker.stdout, `${sessionId}.jsonl\n`);
	await assertDecision(setup, { resume: true });
	const entries = await decisions(setup);
	strictEqual(
		entries.some((entry: Readonly<Record<string, unknown>>) =>
			Object.hasOwn(entry, "sessionId"),
		),
		false,
	);
});

const assertSharedSettings = async (setup: Fixture): Promise<void> => {
	const linked = await lstat(
		path.join(setup.home, ".claude-dev3/settings.json"),
	);
	ok(linked.isSymbolicLink());
	const settings = await readFile(settingsFile(setup), "utf8");
	ok(
		settings.startsWith(
			'{ "autoContinueAtUsageLimit": false, "permissions": {"allow":["Read"]} ,"statusLine":',
		),
	);
};

await test("an exhausted dev2 session resumes by id on dev3 with its persisted prior context", async (context: Context): Promise<void> => {
	const setup = await sessionFixture(context);
	await seedRouting(setup, { dev: full, dev2: full, main: full });
	const resumed = await run(setup, ["-r", sessionId]);
	strictEqual(resumed.status, success, resumed.stderr);
	strictEqual(resumed.stderr, "cc: using dev3\nreturned:0\n");
	strictEqual(resumed.stdout, `.claude-dev2: ${priorContext}\n`);
	await assertDecision(setup, { resume: true, seat: "dev3", sessionId });
	await assertSharedSettings(setup);
});

await test("manual resume normalizes -r and preserves literal trailing arguments and exec semantics", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const tail = [
		sessionId,
		"-p",
		"private prompt",
		"",
		"$(false)",
		"line\nbreak",
		"trailing\n",
	];
	const result = await run(setup, ["@dev", "-r", ...tail]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev"),
		"--resume",
		...tail,
	]);
	await assertDecision(setup, { mode: "manual", sessionId });
	const picker = await run(setup, ["@main", "-r"]);
	strictEqual(picker.status, success, picker.stderr);
	assertLaunch(picker.stdout, ["unset", "", "--resume"]);
});

await test("-- and later -r arguments stay literal and do not become resume audit metadata", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await Promise.all(
		[
			["--", "-r", sessionId],
			["-p", "-r", sessionId],
		].map(async (args: readonly string[]): Promise<void> => {
			const result = await run(setup, ["@main", ...args]);
			strictEqual(result.status, success, result.stderr);
			assertLaunch(result.stdout, ["unset", "", ...args]);
		}),
	);
	for (const entry of await decisions(setup)) {
		strictEqual(Object.hasOwn(entry, "resume"), false);
		strictEqual(Object.hasOwn(entry, "sessionId"), false);
	}
});

await test("cc @dev -r opens the manual picker with additional Claude options intact", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const result = await run(setup, ["@dev", "-r", "--model", "sonnet"]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, [
		"set",
		path.join(setup.home, ".claude-dev"),
		"--resume",
		"--model",
		"sonnet",
	]);
	await assertDecision(setup, { mode: "manual", resume: true, seat: "dev" });
	const [entry] = await decisions(setup);
	ok(entry);
	strictEqual(Object.hasOwn(entry, "sessionId"), false);
});

await test("resume audit survives the manual busy-lock escape hatch", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await mkdir(path.join(setup.directory, "state/routing.lock"), {
		recursive: true,
	});
	const result = await run(setup, ["@dev", "-r", sessionId]);
	strictEqual(result.status, success, result.stderr);
	const [entry] = await decisions(setup);
	ok(entry);
	strictEqual(entry["sessionId"], sessionId);
	strictEqual(entry["reservation"], "skipped: routing busy");
});

await test("fallback resume keeps the session id in the audit", async (context: Context): Promise<void> => {
	const setup = await setupFallback(context);
	const result = await run(setup, ["--resume", sessionId]);
	strictEqual(result.status, success, result.stderr);
	assertLaunch(result.stdout, ["unset", "", "--resume", sessionId]);
	const [entry] = await decisions(setup);
	ok(entry);
	strictEqual(entry["sessionId"], sessionId);
});

await test("resume search text reaches Claude unchanged but never enters the decisions log", async (context: Context): Promise<void> => {
	await Promise.all(
		["-r", "--resume"].map(async (flag): Promise<void> => {
			const setup = await fixture(context);
			const search = "private session search\nwith a second line";
			const tail = [search, "-p", "private prompt"];
			const result = await run(setup, ["@main", flag, ...tail]);
			strictEqual(result.status, success, result.stderr);
			assertLaunch(result.stdout, ["unset", "", "--resume", ...tail]);
			await assertDecision(setup, { mode: "manual", resume: true });
			for (const entry of await decisions(setup)) {
				strictEqual(Object.hasOwn(entry, "sessionId"), false);
				strictEqual(
					JSON.stringify(entry).includes("private session search"),
					false,
				);
			}
		}),
	);
});

await test("exhausted resume refuses and audits the id without touching shared settings", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup, { dev: full, dev2: full, dev3: full, main: full });
	const result = await run(setup, ["-r", sessionId]);
	strictEqual(result.status, exhausted);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("cc @<seat>"));
	deepStrictEqual(await readdir(setup.home), []);
	await assertDecision(setup, { seat: "none", sessionId });
});

await test("ordinary launches create fail-fast shared settings privately; listing does not", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await run(setup, ["@"]);
	deepStrictEqual(await readdir(setup.home), []);
	const launched = await run(setup, ["@main"]);
	strictEqual(launched.status, success, launched.stderr);
	await assertFailFastSettings(setup);
	const info = await stat(settingsFile(setup));
	strictEqual(info.mode % modeBase, privateMode);
});

await test("invalid shared settings refuse a launch without overwriting or exposing their contents", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await mkdir(path.dirname(settingsFile(setup)), { recursive: true });
	await writeFile(settingsFile(setup), "private invalid settings");
	const result = await run(setup, ["@dev", "-r"]);
	strictEqual(result.status, unavailable);
	strictEqual(result.stdout, "");
	ok(result.stderr.includes("autoContinueAtUsageLimit"));
	strictEqual(result.stderr.includes("private invalid settings"), false);
	strictEqual(
		await readFile(settingsFile(setup), "utf8"),
		"private invalid settings",
	);
});

await test("symlinked hub settings refuse new and resumed launches without changing the link or target", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const target = path.join(setup.directory, "other-settings.json");
	const contents = JSON.stringify({
		autoContinueAtUsageLimit: true,
		keep: "private settings",
	});
	await writeFile(target, contents);
	await mkdir(path.dirname(settingsFile(setup)), { recursive: true });
	await symlink(target, settingsFile(setup));
	await Promise.all(
		[["@main"], ["@dev", "-r", sessionId]].map(
			async (args: readonly string[]): Promise<void> => {
				const result = await run(setup, args);
				strictEqual(result.status, unavailable);
				strictEqual(result.stdout, "");
				ok(result.stderr.includes("autoContinueAtUsageLimit"));
				strictEqual(result.stderr.includes("private settings"), false);
			},
		),
	);
	const link = await lstat(settingsFile(setup));
	ok(link.isSymbolicLink());
	strictEqual(await readFile(target, "utf8"), contents);
});

await test("repeated handoffs leave configured hub settings and every seat settings link untouched", async (context: Context): Promise<void> => {
	const setup = await sessionFixture(context);
	const before = await stat(settingsFile(setup));
	const contents = await readFile(settingsFile(setup), "utf8");
	await Promise.all(
		["dev", "dev2", "dev3"].map(async (seat): Promise<void> => {
			const link = path.join(setup.home, `.claude-${seat}/settings.json`);
			const original = await lstat(link);
			ok(original.isSymbolicLink());
			const result = await run(setup, [`@${seat}`, "-r", sessionId]);
			strictEqual(result.status, success, result.stderr);
			strictEqual(result.stdout, `.claude-dev2: ${priorContext}\n`);
			const after = await lstat(link);
			ok(after.isSymbolicLink());
			strictEqual(after.ino, original.ino);
			strictEqual(await readFile(link, "utf8"), contents);
		}),
	);
	const after = await stat(settingsFile(setup));
	strictEqual(after.ino, before.ino);
	strictEqual(after.mtimeMs, before.mtimeMs);
});

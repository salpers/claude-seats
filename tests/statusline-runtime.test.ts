import { ok, strictEqual } from "node:assert/strict";
import {
	mkdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { slotFor } from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const failure = 1;
const executableMode = 0o700;
const privateMode = 0o600;
const shellQuote = (text: string): string =>
	`'${text.replaceAll("'", String.raw`'\''`)}'`;
const alternateNode = (setup: Fixture): string =>
	path.join(setup.directory, "alternate node", "node");
const settingsFile = (setup: Fixture): string =>
	path.join(setup.home, ".claude/settings.json");
const otherDirectory = (setup: Fixture): Parameters<typeof run>["2"] => ({
	env: Object.fromEntries([
		["CLAUDE_SEATS_TEST_CWD", setup.home],
		["CLAUDE_SEATS_TEST_NODE", alternateNode(setup)],
	]),
	script: 'cd "$HOME"; source "$1"; shift; cc "$@"',
});

const installVersionManager = async (setup: Fixture): Promise<void> => {
	await mkdir(path.dirname(alternateNode(setup)));
	await symlink(process.execPath, alternateNode(setup));
	const node = path.join(path.dirname(setup.binary), "node");
	await rm(node);
	await writeFile(
		node,
		`#!/bin/sh
exec ${shellQuote(process.execPath)} --input-type=module -e 'import { pathToFileURL } from "node:url"; import { realpathSync } from "node:fs"; if (process.env.CLAUDE_SEATS_TEST_CWD && process.cwd() === realpathSync(process.env.CLAUDE_SEATS_TEST_CWD)) Object.defineProperty(process, "execPath", { value: process.env.CLAUDE_SEATS_TEST_NODE }); await import(pathToFileURL(process.argv[1]));' "$@"
`,
		{ mode: executableMode },
	);
};

const installed = async (context: Context): Promise<Fixture> => {
	const setup = await fixture(context);
	await installVersionManager(setup);
	await Promise.all(
		["main", "dev", "dev2", "dev3"].map(async (seat): Promise<void> => {
			await writeFile(
				path.join(setup.keychain, `${slotFor(setup, seat)}.json`),
				"{}",
			);
		}),
	);
	const result = await run(setup, ["install"]);
	strictEqual(result.status, success, result.stderr);
	return setup;
};

const stable = async (
	setup: Fixture,
	options: Parameters<typeof run>["2"] = {},
): Promise<void> => {
	const before = await readFile(settingsFile(setup), "utf8");
	const beforeStat = await stat(settingsFile(setup));
	const checked = await run(setup, ["doctor"], options);
	strictEqual(checked.status, success, checked.stderr);
	const launched = await run(setup, ["@dev"], options);
	strictEqual(launched.status, success, launched.stderr);
	const afterStat = await stat(settingsFile(setup));
	strictEqual(await readFile(settingsFile(setup), "utf8"), before);
	strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs);
};

await test("doctor and launches retain the installed Node across directory-dependent runtime selection", async (context: Context): Promise<void> => {
	const setup = await installed(context);
	await stable(setup, otherDirectory(setup));
	await stable(setup);
	await stable(setup, otherDirectory(setup));
});

const reinstalled = async (context: Context): Promise<Fixture> => {
	const setup = await installed(context);
	const result = await run(setup, ["install"], otherDirectory(setup));
	strictEqual(result.status, success, result.stderr);
	const rewired = await readFile(settingsFile(setup), "utf8");
	ok(rewired.includes(alternateNode(setup)));
	return setup;
};

await test("explicit install selects a new runtime and subsequent launches retain it", async (context: Context): Promise<void> => {
	const setup = await reinstalled(context);
	await stable(setup);
});

const breakRuntime = async (setup: Fixture, kind: string): Promise<void> => {
	await rm(alternateNode(setup));
	if (kind === "directory") {
		await mkdir(alternateNode(setup));
	} else if (kind === "non-executable") {
		await writeFile(alternateNode(setup), "#!/bin/sh\nexit 1\n", {
			mode: privateMode,
		});
	}
};

const assertRepair = async (setup: Fixture): Promise<void> => {
	const before = await readFile(settingsFile(setup), "utf8");
	const broken = await run(setup, ["doctor"]);
	strictEqual(broken.status, failure);
	ok(broken.stderr.includes("statusLine"));
	strictEqual(await readFile(settingsFile(setup), "utf8"), before);
	const repaired = await run(setup, ["@dev"]);
	strictEqual(repaired.status, success, repaired.stderr);
	const after = await readFile(settingsFile(setup), "utf8");
	strictEqual(after.includes(alternateNode(setup)), false);
};

await Promise.all(
	["missing", "directory", "non-executable"].map(
		async (kind): Promise<void> => {
			await test(`doctor diagnoses a ${kind} saved runtime read-only; launch repairs it`, async (context: Context): Promise<void> => {
				const setup = await reinstalled(context);
				await breakRuntime(setup, kind);
				await assertRepair(setup);
			});
		},
	),
);

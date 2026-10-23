import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
	seedRouting,
	seedSharedSessions,
	startSession,
} from "./routing-fixture.ts";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";

const success = 0;
const timeout = 10_000;
const hashLength = 64;
const directoryIndex = 2;
const staleIndex = 1;
const symlinkIndex = 3;
const temporaryIndex = 4;
const keyName = (pid: number, index: number): string =>
	`${pid}.${String(index).padStart(hashLength, "0")}.key`;
const startProcess = async (context: Context): Promise<number> => {
	const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
		timeout,
	});
	context.after(async (): Promise<void> => {
		if (child.exitCode === null && child.signalCode === null) {
			const closed = once(child, "close");
			child.stdin.end();
			await closed;
		}
	});
	await once(child, "spawn");
	ok(typeof child.pid === "number");
	return child.pid;
};
const exitedPid = async (): Promise<number> => {
	const child = spawn(process.execPath, ["-e", ""], { timeout });
	await once(child, "close");
	ok(typeof child.pid === "number");
	strictEqual(child.exitCode, success);
	return child.pid;
};
const registry = async (
	setup: Fixture,
	directory: string,
	pids: readonly number[],
): Promise<string> => {
	const sessions = path.join(setup.home, directory, "sessions");
	await mkdir(sessions, { recursive: true });
	await Promise.all(
		pids.map(async (pid, index): Promise<void> => {
			await writeFile(
				path.join(sessions, keyName(pid, index)),
				'{"pidDomain":"local"}',
			);
		}),
	);
	return sessions;
};
const firstField = 0;
const liveCounts = (stdout: string): Record<string, string | undefined> => {
	const [header, ...rows] = stdout.trimEnd().split("\n");
	ok(typeof header === "string");
	// Columns are padded to a shared width, so the header offset locates each cell.
	const index = header.indexOf("live");
	ok(index >= success, "seat table must have a live column");
	return Object.fromEntries(
		rows.map((row): [string, string | undefined] => {
			const [name] = row.split(" ");
			ok(typeof name === "string");
			return [name, row.slice(index).split(" ").at(firstField)];
		}),
	);
};

const addInvalidEntries = async (
	directory: string,
	pid: number,
): Promise<void> => {
	const subdirectory = path.join(directory, keyName(pid, directoryIndex));
	const link = path.join(directory, keyName(pid, symlinkIndex));
	const temporary = path.join(
		directory,
		`${keyName(pid, temporaryIndex)}.tmp.abcdef`,
	);
	await Promise.all([
		writeFile(path.join(directory, "broken.json"), "{"),
		writeFile(path.join(directory, "invalid.json"), '{"pid":"123"}'),
		writeFile(path.join(directory, "ignored.txt"), JSON.stringify({ pid })),
		mkdir(subdirectory),
		symlink("ignored.txt", link),
		writeFile(temporary, "{}"),
	]);
};

const assertKeyUnchanged = async (
	dev: string,
	stale: number,
): Promise<void> => {
	const staleFile = path.join(dev, keyName(stale, staleIndex));
	strictEqual(await readFile(staleFile, "utf8"), '{"pidDomain":"local"}');
};

await test("cc @ shows dev live 1, dev3 live 2 and zero elsewhere, ignoring stale or malformed entries", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const second = await startProcess(context);
	const stale = await exitedPid();
	const dev = await registry(setup, ".claude-dev", [
		process.pid,
		stale,
		process.pid,
	]);
	await Promise.all([
		registry(setup, ".claude-dev3", [process.pid, second]),
		registry(setup, ".claude-api", [process.pid]),
		addInvalidEntries(dev, second),
	]);
	const result = await run(setup, ["@"]);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "returned:0\n");
	deepStrictEqual(liveCounts(result.stdout), {
		dev: "1",
		dev2: "0",
		dev3: "2",
		main: "0",
	});
	await assertKeyUnchanged(dev, stale);
});

await test("main's live count comes from bare .claude under the effective home", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await registry(setup, ".claude", [process.pid]);
	await registry(setup, ".claude-main", []);
	const overridden = await run(setup, ["@"], {
		env: Object.fromEntries([
			["HOME", path.join(setup.directory, "different-home")],
		]),
	});
	const defaultHome = await run(setup, ["@"], { omit: ["CLAUDE_SEATS_HOME"] });
	for (const result of [overridden, defaultHome]) {
		strictEqual(result.status, success, result.stderr);
		deepStrictEqual(liveCounts(result.stdout), {
			dev: "0",
			dev2: "0",
			dev3: "0",
			main: "1",
		});
	}
});

await test("seats linked to one registry count each session on the seat its CLAUDE_CONFIG_DIR names", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const pids = await Promise.all(
		["main", "dev3", "dev3"].map(async (name) =>
			startSession(context, setup, name),
		),
	);
	await seedSharedSessions(
		setup,
		["main", "dev", "dev2", "dev3"],
		[...pids, await exitedPid()],
	);
	const result = await run(setup, ["@"]);
	strictEqual(result.status, success, result.stderr);
	deepStrictEqual(liveCounts(result.stdout), {
		dev: "0",
		dev2: "0",
		dev3: "2",
		main: "1",
	});
});

await test("cc ranks seats on a shared registry by the live sessions each seat runs", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	await seedRouting(setup);
	const pids = await Promise.all(
		["main", "dev", "dev3"].map(async (name) =>
			startSession(context, setup, name),
		),
	);
	await seedSharedSessions(setup, ["main", "dev", "dev2", "dev3"], pids);
	const result = await run(setup, []);
	strictEqual(result.status, success, result.stderr);
	strictEqual(result.stderr, "cc: using dev2\nreturned:0\n");
});

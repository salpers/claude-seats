import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { renderStatuslineSegment } from "./statusline-segment.ts";
import { createUsageCache } from "./usage-cache.ts";
import { snapshot } from "./usage-test-fixture.ts";

type Context = Readonly<Pick<TestContext, "after">>;
const timeZone = "Europe/Berlin";
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(
		path.join(tmpdir(), "claude-seats-statusline-"),
	);
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	return directory;
};

await test("first-response fallback reads the router's actual cache format and leaves it untouched", async (context: Context): Promise<void> => {
	const home = await fixture(context);
	const directory = path.join(home, ".claude-shared", "_seats");
	strictEqual(await createUsageCache(directory).write("dev3", snapshot), true);
	const file = path.join(directory, "usage-dev3.json");
	const before = await readFile(file, "utf8");
	const env = Object.fromEntries([
		["CLAUDE_CONFIG_DIR", path.join(home, ".claude-dev3")],
		["CLAUDE_SEATS_HOME", home],
		["HOME", path.join(home, "other")],
	]);
	strictEqual(
		await renderStatuslineSegment("{}", env, { timeZone }),
		"dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00",
	);
	strictEqual(await readFile(file, "utf8"), before);
	deepStrictEqual(await readdir(directory), ["usage-dev3.json"]);
});

await test("bare main uses the state override and never creates a cache on a miss", async (context: Context): Promise<void> => {
	const home = await fixture(context);
	const directory = path.join(home, "separate state");
	const env = Object.fromEntries([
		["CLAUDE_SEATS_STATE_DIR", directory],
		["HOME", home],
	]);
	strictEqual(await renderStatuslineSegment("{}", env), "main · 5h — · 7d —");
	deepStrictEqual(await readdir(home), []);
	strictEqual(await createUsageCache(directory).write("main", snapshot), true);
	strictEqual(
		await renderStatuslineSegment("{}", env, { timeZone }),
		"main · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00",
	);
});

await test("corrupt and unreadable cache files remain unchanged and display em dashes", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const file = path.join(directory, "usage-main.json");
	const env = Object.fromEntries([["CLAUDE_SEATS_STATE_DIR", directory]]);
	await writeFile(file, '{"private":"discard"}');
	strictEqual(await renderStatuslineSegment("{}", env), "main · 5h — · 7d —");
	strictEqual(await readFile(file, "utf8"), '{"private":"discard"}');
	await rm(file);
	await mkdir(file);
	strictEqual(await renderStatuslineSegment("{}", env), "main · 5h — · 7d —");
	deepStrictEqual(await readdir(file), []);
});

const aliases = async (context: Context): Promise<string> => {
	const home = await fixture(context);
	const seat = path.join(home, ".claude-dev3");
	await mkdir(seat);
	await Promise.all([
		symlink(seat, path.join(home, "seat-alias")),
		symlink(home, path.join(home, "home-alias")),
		symlink(path.join(home, "missing"), path.join(home, "dangling")),
	]);
	strictEqual(
		await createUsageCache(path.join(home, "state")).write("dev3", snapshot),
		true,
	);
	return home;
};

await test("symlinked config directories and homes retain the seat and cache fallback", async (context: Context): Promise<void> => {
	const home = await aliases(context);
	await Promise.all(
		[
			[home, path.join(home, "seat-alias")],
			[path.join(home, "home-alias"), path.join(home, ".claude-dev3")],
			[home, path.join(home, "home-alias", ".claude-dev3")],
		].map(async ([seatHome, config]: readonly string[]): Promise<void> => {
			const env = Object.fromEntries([
				["CLAUDE_CONFIG_DIR", config],
				["CLAUDE_SEATS_HOME", seatHome],
				["CLAUDE_SEATS_STATE_DIR", path.join(home, "state")],
			]);
			strictEqual(
				await renderStatuslineSegment("{}", env, { timeZone }),
				"dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00",
			);
		}),
	);
});

await test("broken or unregistered directory aliases never borrow a seat's cache", async (context: Context): Promise<void> => {
	const home = await aliases(context);
	await Promise.all(
		["dangling", "other"].map(async (config): Promise<void> => {
			const env = Object.fromEntries([
				["CLAUDE_CONFIG_DIR", path.join(home, config)],
				["CLAUDE_SEATS_HOME", home],
				["CLAUDE_SEATS_STATE_DIR", path.join(home, "state")],
			]);
			strictEqual(
				await renderStatuslineSegment("{}", env),
				"unknown · 5h — · 7d —",
			);
		}),
	);
});

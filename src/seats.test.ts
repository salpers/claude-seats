import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { createSeats, loadSeats, seatsConfigPath } from "./seats.ts";

type Context = Readonly<Pick<TestContext, "after">>;
const temporaryRoot = async (context: Context): Promise<string> => {
	const root = await mkdtemp(path.join(tmpdir(), "claude-seats-config-"));
	context.after(async (): Promise<void> => {
		await rm(root, { force: true, recursive: true });
	});
	return root;
};
const homeWithConfig = async (home: string, text: string): Promise<string> => {
	await mkdir(path.join(home, ".claude-shared"), { recursive: true });
	await writeFile(seatsConfigPath(home), text);
	return home;
};

await test("the registry contains only the four seats and their known keychain slots", (): void => {
	deepStrictEqual(createSeats("/Users/me"), [
		{
			directory: "/Users/me/.claude",
			name: "main",
			slot: "Claude Code-credentials",
		},
		{
			directory: "/Users/me/.claude-dev",
			name: "dev",
			slot: "Claude Code-credentials-9cb3e83e",
		},
		{
			directory: "/Users/me/.claude-dev2",
			name: "dev2",
			slot: "Claude Code-credentials-374e2450",
		},
		{
			directory: "/Users/me/.claude-dev3",
			name: "dev3",
			slot: "Claude Code-credentials-6f316b21",
		},
	]);
});

await test("seat paths and slot hashes follow the overridden home", (): void => {
	const seats = createSeats("/tmp/seat home/");
	const [main, , dev2] = seats;
	ok(main && dev2);
	strictEqual(main.directory, "/tmp/seat home/.claude");
	strictEqual(main.slot, "Claude Code-credentials");
	strictEqual(dev2.directory, "/tmp/seat home/.claude-dev2");
	strictEqual(dev2.slot, "Claude Code-credentials-720971ec");
	strictEqual(
		seats.some((seat) => seat.directory.endsWith(".claude-api")),
		false,
	);
});

await test("without seats.json the four default seats load; with it, the configured seats load in file order", async (context: Context): Promise<void> => {
	const root = await temporaryRoot(context);
	deepStrictEqual(await loadSeats(root), {
		ok: true,
		seats: createSeats(root),
	});
	const home = await homeWithConfig(root, '["work", "main"]');
	deepStrictEqual(await loadSeats(home), {
		ok: true,
		seats: createSeats(home, ["work", "main"]),
	});
	const [work, main] = createSeats(home, ["work", "main"]);
	ok(work && main);
	strictEqual(work.directory, path.join(home, ".claude-work"));
	strictEqual(main.directory, path.join(home, ".claude"));
});

await test("seats.json must be a readable list of unique, safe, unreserved names and is never echoed", async (context: Context): Promise<void> => {
	const root = await temporaryRoot(context);
	const invalid = [
		"{",
		"{}",
		"[]",
		"[1]",
		'["main", "main"]',
		'["Main"]',
		'["../escape"]',
		'["-dash"]',
		'["two words"]',
		'["none"]',
		'["shared"]',
		'["unknown"]',
	];
	const results = await Promise.all(
		invalid.map(async (text, index) => {
			const home = path.join(root, String(index));
			return loadSeats(await homeWithConfig(home, text));
		}),
	);
	const unreadable = path.join(root, "unreadable");
	await mkdir(seatsConfigPath(unreadable), { recursive: true });
	const directoryResult = await loadSeats(unreadable);
	for (const result of [...results, directoryResult]) {
		ok(!result.ok);
		ok(result.reason.includes("seats.json"));
		ok(!result.reason.includes("escape"));
	}
});

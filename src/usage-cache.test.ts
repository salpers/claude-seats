import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import type { SeatName } from "./seats.ts";
import type { UsageCache } from "./usage-cache.ts";
import { createUsageCache, parseSnapshot } from "./usage-cache.ts";
import { cacheHit, snapshot } from "./usage-test-fixture.ts";

const modeBase = 0o1000;
const privateMode = 0o600;
const publicMode = 0o644;
const seats: readonly SeatName[] = ["main", "dev", "dev2", "dev3"];
type Context = Readonly<Pick<TestContext, "after">>;
const fixture = async (context: Context): Promise<string> => {
	const root = await mkdtemp(path.join(tmpdir(), "claude-seats-cache-"));
	context.after(async (): Promise<void> => {
		await rm(root, { force: true, recursive: true });
	});
	return root;
};
const assertMode = async (file: string): Promise<void> => {
	const { mode } = await stat(file);
	strictEqual(mode % modeBase, privateMode);
};
const assertFile = async (file: string): Promise<void> => {
	await assertMode(file);
	const text = await readFile(file, "utf8");
	strictEqual(text.includes("discard"), false);
	strictEqual(text.includes("accessToken"), false);
};
const assertSeatCache = async (
	cache: UsageCache,
	seat: SeatName,
	directory: string,
): Promise<void> => {
	const extra = {
		...snapshot,
		accessToken: "discard",
		usage: { ...snapshot.usage, private: "discard" },
	};
	strictEqual(await cache.write(seat, extra), true);
	deepStrictEqual(await cache.read(seat), cacheHit(snapshot));
	const file = path.join(directory, `usage-${seat}.json`);
	await assertFile(file);
	await chmod(file, publicMode);
	strictEqual(await cache.write(seat, snapshot), true);
	await assertMode(file);
};

await test("cache parsing rejects malformed timestamps and payloads and strips unknown fields", (): void => {
	deepStrictEqual(
		parseSnapshot(
			JSON.stringify({
				...snapshot,
				private: "discard",
				usage: { ...snapshot.usage, private: "discard" },
			}),
		),
		cacheHit(snapshot),
	);
	for (const value of [
		"{",
		"null",
		"[]",
		"{}",
		JSON.stringify({ ...snapshot, fetchedAt: -1 }),
		JSON.stringify({ ...snapshot, fetchedAt: "1000" }),
		JSON.stringify({ ...snapshot, usage: {} }),
	]) {
		deepStrictEqual(parseSnapshot(value), { ok: false });
	}
});

await test("each seat has an atomic 0600 cache with only timestamp and whitelisted usage", async (context: Context): Promise<void> => {
	const root = await fixture(context);
	const directory = path.join(root, ".claude-shared/_seats");
	const cache = createUsageCache(directory);
	deepStrictEqual(await cache.read("main"), { ok: false });
	await Promise.all(
		seats.map(
			async (seat): Promise<void> => assertSeatCache(cache, seat, directory),
		),
	);
	const files = await readdir(directory);
	deepStrictEqual(files.toSorted(), [
		"usage-dev.json",
		"usage-dev2.json",
		"usage-dev3.json",
		"usage-main.json",
	]);
});

await test("corrupt and inaccessible cache files are misses; failed writes are harmless", async (context: Context): Promise<void> => {
	const root = await fixture(context);
	const cache = createUsageCache(root);
	await writeFile(path.join(root, "usage-main.json"), "{");
	deepStrictEqual(await cache.read("main"), { ok: false });
	const blocked = createUsageCache(path.join(root, "usage-main.json/state"));
	deepStrictEqual(await blocked.read("main"), { ok: false });
	strictEqual(await blocked.write("main", snapshot), false);
	ok(await cache.write("main", snapshot));
});

await test("a failed atomic rename preserves the destination and cleans temporary files", async (context: Context): Promise<void> => {
	const root = await fixture(context);
	await mkdir(path.join(root, "usage-main.json"));
	strictEqual(await createUsageCache(root).write("main", snapshot), false);
	deepStrictEqual(await readdir(root), ["usage-main.json"]);
});

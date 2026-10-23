import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
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
import type { FallbackState } from "./fallback.ts";
import {
	parseFallbackState,
	readFallbackState,
	writeFallbackState,
} from "./fallback-state.ts";
import type { RoutingSeat } from "./router.ts";
import { routeWithState } from "./routing-state.ts";

type Context = Readonly<Pick<TestContext, "after">>;
const state: FallbackState = {
	cooldowns: [{ seat: "main", until: 1000 }],
	lastSeat: "dev",
};
const modeBase = 0o1000;
const privateMode = 0o600;
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(
		path.join(tmpdir(), "claude-seats-fallback-"),
	);
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	return directory;
};

await test("fallback parsing rejects malformed state, invalid seats, duplicate cooldowns and unsafe timestamps", (): void => {
	for (const text of [
		"{",
		"null",
		"[]",
		"{}",
		'{"cooldowns":[],"lastSeat":"api"}',
		...[
			"null",
			"{}",
			'{"seat":"api","until":100}',
			'{"seat":"main","until":"100"}',
			'{"seat":"main","until":-1}',
			'{"seat":"main","until":1.5}',
			'{"seat":"main","until":9007199254740991}',
		].map((value) => `{"cooldowns":[${value}],"lastSeat":"none"}`),
		'{"cooldowns":[{"seat":"main","until":1},{"seat":"main","until":2}],"lastSeat":"none"}',
	]) {
		deepStrictEqual(parseFallbackState(text), { ok: false });
	}
});

const assertPrivateFile = async (file: string): Promise<void> => {
	const info = await stat(file);
	strictEqual(info.mode % modeBase, privateMode);
	const text = await readFile(file, "utf8");
	strictEqual(text.includes("discard"), false);
};

await test("fallback files are atomic, private and contain only validated seat names and timestamps", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	deepStrictEqual(await readFallbackState(directory), {
		ok: true,
		state: { cooldowns: [], lastSeat: "none" },
	});
	const extra = {
		...state,
		cooldowns: state.cooldowns.map((entry) => ({
			...entry,
			private: "discard",
		})),
		private: "discard",
	};
	ok(
		await writeFallbackState(directory, {
			...extra,
			cooldowns: state.cooldowns,
		}),
	);
	deepStrictEqual(parseFallbackState(JSON.stringify(extra)), {
		ok: true,
		state,
	});
	deepStrictEqual(await readFallbackState(directory), { ok: true, state });
	await assertPrivateFile(path.join(directory, "fallback.json"));
	deepStrictEqual(await readdir(directory), ["fallback.json"]);
});

await test("corrupt or inaccessible fallback state fails closed and failed writes clean temporary files", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const file = path.join(directory, "fallback.json");
	await writeFile(file, "private invalid state");
	deepStrictEqual(await readFallbackState(directory), { ok: false });
	await rm(file);
	await mkdir(file);
	deepStrictEqual(await readFallbackState(directory), { ok: false });
	strictEqual(await writeFallbackState(directory, state), false);
	deepStrictEqual(await readdir(directory), ["fallback.json"]);
});

await test("a fallback persistence failure never grants a launch and always releases the routing lock", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const rows: readonly RoutingSeat[] = [
		{ live: 0, probe: true, seat: "main", usage: "unknown" },
	];
	const result = await routeWithState(directory, () => rows, {
		probe: async () => {
			await mkdir(path.join(directory, "fallback.json"));
			return { kind: "available" };
		},
	});
	deepStrictEqual(result, { ok: false, reason: "routing state unavailable" });
	const files = await readdir(directory);
	strictEqual(files.includes("routing.lock"), false);
});

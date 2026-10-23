import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { ensureHandoffSettings, failFastSettings } from "./handoff-settings.ts";
import type { ConfigRead, ConfigSnapshot } from "./project-config-file.ts";

const home = "/fixture";
const settingsFile = "/fixture/.claude/settings.json";
const snapshot = (text: string): ConfigSnapshot => ({
	exists: true,
	mode: 0o600,
	ok: true,
	text,
});
const unexpected = (): never => {
	throw new TypeError("Unexpected write");
};

await test("fail-fast settings change only the top-level limit setting and preserve unrelated bytes", (): void => {
	const before =
		'{\n "autoContinueAtUsageLimit" : true, "keep": [1e+02, {"autoContinueAtUsageLimit":true}]\n}\n';
	deepStrictEqual(failFastSettings(before), {
		ok: true,
		text: before.replace(": true", ": false"),
	});
	deepStrictEqual(failFastSettings("{}"), {
		ok: true,
		text: JSON.stringify({ autoContinueAtUsageLimit: false }),
	});
	const unchanged = ' { "autoContinueAtUsageLimit": false }\n';
	deepStrictEqual(failFastSettings(unchanged), { ok: true, text: unchanged });
	for (const text of [
		"private invalid settings",
		"[]",
		"null",
		`{${JSON.stringify("autoContinueAtUsageLimit")}:true,${JSON.stringify("autoContinueAtUsageLimit")}:false}`,
	]) {
		deepStrictEqual(failFastSettings(text), { ok: false });
	}
});

await test("shared settings use the home hub and already-disabled settings cause no write", async (): Promise<void> => {
	let saved = "{}";
	const io = {
		read: (file: string): ConfigSnapshot => {
			strictEqual(file, settingsFile);
			return snapshot(saved);
		},
		write: (file: string, original: ConfigSnapshot, text: string): boolean => {
			strictEqual(file, settingsFile);
			strictEqual(original.text, "{}");
			saved = text;
			return true;
		},
	};
	deepStrictEqual(await ensureHandoffSettings(home, io), { ok: true });
	deepStrictEqual(
		await ensureHandoffSettings(home, { ...io, write: unexpected }),
		{ ok: true },
	);
});

await test("another launch disabling the same setting during staging is a successful no-op", async (): Promise<void> => {
	let saved = "{}";
	deepStrictEqual(
		await ensureHandoffSettings(home, {
			read: (): ConfigSnapshot => snapshot(saved),
			write: (): boolean => {
				saved = JSON.stringify({ autoContinueAtUsageLimit: false });
				return false;
			},
		}),
		{ ok: true },
	);
});

await test("a concurrent unrelated settings edit is preserved when disabling the limit setting is retried", async (): Promise<void> => {
	const before = JSON.stringify({
		autoContinueAtUsageLimit: true,
		permissions: { allow: [] },
	});
	const concurrent = JSON.stringify({
		autoContinueAtUsageLimit: true,
		permissions: { allow: ["Read"] },
	});
	let saved = before;
	const originals: string[] = [];
	const result = await ensureHandoffSettings(home, {
		read: (): ConfigSnapshot => snapshot(saved),
		write: (file: string, original: ConfigSnapshot, text: string): boolean => {
			strictEqual(file, settingsFile);
			originals.push(original.text);
			if (saved === before) {
				saved = concurrent;
				return false;
			}
			strictEqual(original.text, saved);
			saved = text;
			return true;
		},
	});
	deepStrictEqual(result, { ok: true });
	deepStrictEqual(originals, [before, concurrent]);
	strictEqual(saved, concurrent.replace(":true", ":false"));
});

await test("settings retry is bounded when concurrent edits keep preventing publication", async (): Promise<void> => {
	const versions = ['{"keep":1}', '{"keep":2}', '{"keep":3}'];
	const attempts: string[] = [];
	let saved = versions.shift() ?? "";
	const result = await ensureHandoffSettings(home, {
		read: (): ConfigSnapshot => snapshot(saved),
		write: (_file: string, original: ConfigSnapshot): boolean => {
			attempts.push(original.text);
			saved = versions.shift() ?? saved;
			return false;
		},
	});
	strictEqual(result.ok, false);
	deepStrictEqual(attempts, ['{"keep":1}', '{"keep":2}']);
	strictEqual(saved, '{"keep":3}');
});

await test("retry never recreates a removed hub or overwrites invalid or unreadable settings", async (): Promise<void> => {
	const changed: readonly ConfigRead[] = [
		{ ...snapshot("{}"), exists: false },
		snapshot("private invalid settings"),
		{ ok: false },
	];
	await Promise.all(
		changed.map(async (current): Promise<void> => {
			let saved: ConfigRead = snapshot("{}");
			const attempts: string[] = [];
			const result = await ensureHandoffSettings(home, {
				read: (): ConfigRead => saved,
				write: (_file: string, original: ConfigSnapshot): boolean => {
					attempts.push(original.text);
					saved = current;
					return false;
				},
			});
			strictEqual(result.ok, false);
			deepStrictEqual(attempts, ["{}"]);
			strictEqual(
				JSON.stringify(result).includes("private invalid settings"),
				false,
			);
		}),
	);
});

await test("retry preserves changed permissions and accepts another writer disabling the setting", async (): Promise<void> => {
	const sharedMode = 0o640;
	const before = snapshot("{}");
	const concurrent = { ...before, mode: sharedMode };
	let saved = before;
	const attempts: ConfigSnapshot[] = [];
	const result = await ensureHandoffSettings(home, {
		read: (): ConfigSnapshot => saved,
		write: (_file: string, original: ConfigSnapshot, text: string): boolean => {
			attempts.push(original);
			if (saved.mode === before.mode) {
				saved = concurrent;
				return false;
			}
			saved = { ...concurrent, text };
			return false;
		},
	});
	deepStrictEqual(result, { ok: true });
	deepStrictEqual(attempts, [before, concurrent]);
	strictEqual(saved.mode, sharedMode);
	strictEqual(saved.text, JSON.stringify({ autoContinueAtUsageLimit: false }));
});

await test("unreadable, invalid and unwritable settings fail safely without echoing private data", async (): Promise<void> => {
	const readers = [
		(): ConfigRead => ({ ok: false }),
		(): ConfigRead => snapshot("private invalid settings"),
		(): ConfigRead => snapshot("{}"),
		(): never => {
			throw new Error("private diagnostic");
		},
	];
	await Promise.all(
		readers.map(async (read): Promise<void> => {
			const result = await ensureHandoffSettings(home, {
				read,
				write: (): boolean => false,
			});
			deepStrictEqual(result, {
				ok: false,
				reason:
					"Cannot disable autoContinueAtUsageLimit in shared .claude/settings.json.",
			});
		}),
	);
});

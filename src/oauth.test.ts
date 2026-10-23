import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { parseCredential, readCredential } from "./oauth.ts";
import { credentialText, synthetic, unexpected } from "./usage-test-fixture.ts";

const success = 0;
const missing = 44;
const failure = 1;
const unavailable = { ok: false, reason: "credential unavailable" };
const reject = (): never => {
	throw new Error(synthetic);
};

await test("an empty fixture directory never reads relative slot files or the keychain", async (): Promise<void> => {
	const calls: string[] = [];
	const result = await readCredential("slot", {
		fixtureDirectory: "",
		io: {
			readFile: (file: string): string => {
				calls.push(file);
				return "{}";
			},
			readKeychain: () => {
				calls.push("keychain");
				return { status: failure, stdout: "" };
			},
		},
	});
	deepStrictEqual(result, unavailable);
	deepStrictEqual(calls, []);
});

await test("credential JSON is validated and only the access credential is retained", (): void => {
	const result = parseCredential(credentialText);
	strictEqual(result.ok && result.accessToken === synthetic, true);
	strictEqual(JSON.stringify(result).includes("unused"), false);
	for (const text of [
		"{",
		"null",
		"[]",
		"{}",
		'{"claudeAiOauth":null}',
		'{"claudeAiOauth":{"accessToken":123}}',
		'{"claudeAiOauth":{"accessToken":""}}',
		String.raw`{"claudeAiOauth":{"accessToken":"\n"}}`,
	]) {
		deepStrictEqual(parseCredential(text), {
			ok: false,
			reason: "invalid credential",
		});
	}
});

await test("fixture credential reads bypass the keychain and use the seat slot", async (): Promise<void> => {
	const paths: string[] = [];
	const result = await readCredential("seat-slot", {
		fixtureDirectory: "/fixtures",
		io: {
			readFile: (file: string): string => {
				paths.push(file);
				return credentialText;
			},
			readKeychain: unexpected,
		},
	});
	strictEqual(result.ok && result.accessToken === synthetic, true);
	deepStrictEqual(paths, ["/fixtures/seat-slot.json"]);
});

await test("keychain reads use password output in memory and distinguish absent entries", async (): Promise<void> => {
	await Promise.all(
		[success, missing, failure].map(async (status): Promise<void> => {
			const calls: (readonly string[])[] = [];
			const result = await readCredential("seat-slot", {
				io: {
					readFile: unexpected,
					readKeychain: (
						args: readonly string[],
					): { status: number; stdout: string } => {
						calls.push(args);
						return { status, stdout: credentialText };
					},
				},
			});
			deepStrictEqual(calls, [
				["find-generic-password", "-s", "seat-slot", "-w"],
			]);
			if (status === success) {
				strictEqual(result.ok && result.accessToken === synthetic, true);
			} else if (status === missing) {
				deepStrictEqual(result, { ok: false, reason: "not logged in" });
			} else {
				deepStrictEqual(result, unavailable);
			}
		}),
	);
});

await test("credential exceptions never escape or reflect private diagnostics", async (): Promise<void> => {
	const io = { readFile: reject, readKeychain: reject };
	const results = await Promise.all([
		readCredential("slot", { io }),
		readCredential("slot", { fixtureDirectory: "/fixtures", io }),
	]);
	for (const result of results) {
		deepStrictEqual(result, unavailable);
	}
	deepStrictEqual(
		await readCredential("slot", {
			fixtureDirectory: "/fixtures",
			io: {
				readFile: (): never => {
					throw Object.assign(new Error(synthetic), { code: "ENOENT" });
				},
				readKeychain: unexpected,
			},
		}),
		{ ok: false, reason: "not logged in" },
	);
});

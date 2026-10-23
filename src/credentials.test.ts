import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { checkCredential } from "./credentials.ts";

const reject = (): never => {
	throw new Error("private diagnostic");
};
const success = 0;
const missing = 44;
const failure = 1;
const unavailable = { ok: false, reason: "Credential presence unavailable." };
const unexpected = (): never => {
	throw new Error("Unexpected credential access");
};

await test("an empty fixture directory refuses without consulting cwd or the keychain", async (): Promise<void> => {
	const calls: string[] = [];
	const result = await checkCredential("slot", {
		fixtureDirectory: "",
		io: {
			fileExists: (file: string): boolean => {
				calls.push(file);
				return true;
			},
			securityStatus: (): number => {
				calls.push("keychain");
				return failure;
			},
		},
	});
	deepStrictEqual(result, unavailable);
	deepStrictEqual(calls, []);
});

await test("fixture presence checks only the slot file and bypasses the keychain", async (): Promise<void> => {
	const paths: string[] = [];
	const result = await checkCredential("Claude Code-credentials", {
		fixtureDirectory: "/fixtures",
		io: {
			fileExists: (file: string): boolean => {
				paths.push(file);
				return true;
			},
			securityStatus: unexpected,
		},
	});
	deepStrictEqual(result, { ok: true, present: true });
	deepStrictEqual(paths, ["/fixtures/Claude Code-credentials.json"]);
});

await test("keychain presence queries metadata only and never requests credential data", async (): Promise<void> => {
	await Promise.all(
		[
			{ present: true, status: success },
			{ present: false, status: missing },
		].map(
			async ({
				present,
				status,
			}: Readonly<{ present: boolean; status: number }>): Promise<void> => {
				const calls: (readonly string[])[] = [];
				const result = await checkCredential("Claude Code-credentials", {
					io: {
						fileExists: unexpected,
						securityStatus: (args: readonly string[]): number => {
							calls.push(args);
							return status;
						},
					},
				});
				deepStrictEqual(result, { ok: true, present });
				deepStrictEqual(calls, [
					["find-generic-password", "-s", "Claude Code-credentials"],
				]);
			},
		),
	);
});

await test("missing fixtures are absent", async (): Promise<void> => {
	const result = await checkCredential("slot", {
		fixtureDirectory: "/fixtures",
		io: {
			fileExists: (): boolean => false,
			securityStatus: unexpected,
		},
	});
	deepStrictEqual(result, { ok: true, present: false });
});

await test("operational errors never expose their details", async (): Promise<void> => {
	const io = { fileExists: reject, securityStatus: reject };
	const results = await Promise.all([
		checkCredential("slot", { io }),
		checkCredential("slot", { fixtureDirectory: "/fixtures", io }),
		checkCredential("slot", {
			io: {
				fileExists: unexpected,
				securityStatus: (): number => failure,
			},
		}),
		checkCredential("slot", {
			fixtureDirectory: "/fixtures",
			io: {
				fileExists: (): "unavailable" => "unavailable",
				securityStatus: unexpected,
			},
		}),
	]);
	for (const result of results) {
		deepStrictEqual(result, unavailable);
	}
});

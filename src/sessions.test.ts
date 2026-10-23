import { deepStrictEqual, strictEqual } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { SessionIo } from "./sessions.ts";
import { countLiveSessions, parseSession } from "./sessions.ts";

const livePid = 123;
const otherPid = 456;
const deadPid = 789;
const zero = 0;
const one = 1;
const two = 2;
const directory = "/fixture/.claude-dev";
const hashLength = 64;
const hash = "b".repeat(hashLength);
const fractionalPid = 1.5;
const oversizedPid = 2_147_483_648;
const unsafePid = 9_007_199_254_740_992;
const key = (pid: number): string => `${pid}.${hash}.key`;
const unexpected = (): never => {
	throw new TypeError("Unexpected I/O");
};
const failure = (code: string): never => {
	throw Object.assign(new Error("private diagnostic"), { code });
};
const fixtureIo = (entries: readonly string[]): SessionIo => ({
	probePid: unexpected,
	readDirectory: (): readonly string[] => entries,
});

await test("session filenames retain only a valid positive process ID and complete key hash", (): void => {
	deepStrictEqual(parseSession(key(livePid)), { ok: true, pid: livePid });
	deepStrictEqual(parseSession(`${livePid}.json`), { ok: true, pid: livePid });
	for (const file of [
		"session.json",
		'{"pid":123}',
		key(zero),
		key(-one),
		key(fractionalPid),
		key(oversizedPid),
		key(unsafePid),
		`${livePid}.${hash.toUpperCase()}.key`,
		`${livePid}.${hash.slice(one)}.key`,
		`${livePid}.${hash}a.key`,
		`${livePid}.${hash}.key.tmp.abcdef`,
		`${livePid}.${hash}.key\n`,
		`${livePid}.${hash}.json`,
		`nested/${key(livePid)}`,
	]) {
		deepStrictEqual(parseSession(file), { ok: false });
	}
});

await test("counts distinct live PIDs from final key filenames without reading their contents", async (): Promise<void> => {
	const probes: number[] = [];
	const count = await countLiveSessions(directory, {
		probePid: (pid: number): void => {
			probes.push(pid);
			if (pid === deadPid) {
				failure("ESRCH");
			}
		},
		readDirectory: (file: string): readonly string[] => {
			strictEqual(file, path.join(directory, "sessions"));
			return [
				key(livePid),
				`${livePid}.${"a".repeat(hash.length)}.key`,
				key(deadPid),
				"session.json",
				`${otherPid}.${hash}.key.tmp.abcdef`,
				key(otherPid),
			];
		},
	});
	strictEqual(count, two);
	deepStrictEqual(probes, [livePid, deadPid, otherPid]);
});

await test("missing, empty and unreadable registries count as zero", async (): Promise<void> => {
	strictEqual(await countLiveSessions(directory, fixtureIo([])), zero);
	await Promise.all(
		["ENOENT", "EACCES", "ENOTDIR"].map(async (code): Promise<void> => {
			strictEqual(
				await countLiveSessions(directory, {
					probePid: unexpected,
					readDirectory: (): never => failure(code),
				}),
				zero,
			);
		}),
	);
});

await test("permission-denied PID checks mean alive; other probe failures are skipped", async (): Promise<void> => {
	await Promise.all(
		[
			{ code: "EPERM", expected: one },
			{ code: "ESRCH", expected: zero },
			{ code: "EINVAL", expected: zero },
		].map(
			async ({
				code,
				expected,
			}: Readonly<{ code: string; expected: number }>): Promise<void> => {
				strictEqual(
					await countLiveSessions(directory, {
						probePid: (): never => failure(code),
						readDirectory: (): readonly string[] => [key(livePid)],
					}),
					expected,
				);
			},
		),
	);
});

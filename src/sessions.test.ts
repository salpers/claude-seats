import { deepStrictEqual, strictEqual } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Seat } from "./seats.ts";
import { createSeats } from "./seats.ts";
import type { SessionIo } from "./sessions.ts";
import {
	countLiveSessions,
	parseCommands,
	parseSession,
	seatsOf,
} from "./sessions.ts";

const livePid = 123;
const otherPid = 456;
const deadPid = 789;
const zero = 0;
const one = 1;
const two = 2;
const directory = "/fixture/.claude-dev";
const seat: Seat = { directory, name: "dev", slot: "fixture" };
const seats = createSeats("/fixture");
const shared = "/fixture/.claude-shared/sessions";
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
	readCommands: unexpected,
	readDirectory: (): readonly string[] => entries,
	resolveDirectory: (file: string): string => file,
});
const countOne = async (io: SessionIo): Promise<number | undefined> => {
	const counts = await countLiveSessions([seat], io);
	return counts.get(seat.name);
};

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
	const count = await countOne({
		...fixtureIo([]),
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
	strictEqual(await countOne(fixtureIo([])), zero);
	await Promise.all(
		["ENOENT", "EACCES", "ENOTDIR"].map(async (code): Promise<void> => {
			strictEqual(
				await countOne({
					...fixtureIo([]),
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
				const io = fixtureIo([key(livePid)]);
				strictEqual(
					await countOne({
						...io,
						probePid: (): never => failure(code),
					}),
					expected,
				);
			},
		),
	);
});

await test("a process's CLAUDE_CONFIG_DIR names its seat; none means main", (): void => {
	for (const [environment, expected] of [
		["", ["main"]],
		["CLAUDE_CONFIG_DIR=/fixture/.claude-dev", ["dev"]],
		["CLAUDE_CONFIG_DIR=/fixture/.claude-dev2/", ["dev2"]],
		["CLAUDE_CONFIG_DIR=/fixture/.claude", ["main"]],
		["CLAUDE_CONFIG_DIR=/fixture/.claude-api", []],
		[String.raw`CLAUDE_CONFIG_DIR=/fixture/.claude-dev\012`, []],
	] as const) {
		deepStrictEqual(
			seatsOf(`claude -r HOME=/fixture ${environment} TERM=xterm`, seats),
			expected,
		);
	}
	deepStrictEqual(
		seatsOf("claude CLAUDE_CONFIG_DIR=/fixture/.claude-dev3", seats),
		["dev3"],
	);
	const odd = createSeats("/home\nü");
	deepStrictEqual(
		seatsOf(
			String.raw`claude CLAUDE_CONFIG_DIR=/home\012\303\274/.claude-dev2`,
			odd,
		),
		["dev2"],
	);
	deepStrictEqual(
		seatsOf(
			"claude -p CLAUDE_CONFIG_DIR=/fixture/.claude-dev CLAUDE_CONFIG_DIR=/fixture/.claude-dev3",
			seats,
		),
		["dev3"],
	);
});

await test("ps lines map each PID to its command and environment", (): void => {
	const lines = `  ${String(livePid)} claude CLAUDE_CONFIG_DIR=/x\n${String(otherPid)} node -e 1\n\nnot a pid\n0 claude\n`;
	deepStrictEqual(
		parseCommands(lines),
		new Map([
			[livePid, "claude CLAUDE_CONFIG_DIR=/x"],
			[otherPid, "node -e 1"],
		]),
	);
});

await test("seats linked to one registry split its live PIDs by CLAUDE_CONFIG_DIR", async (): Promise<void> => {
	const vanishedPid = 321;
	const asked: (readonly number[])[] = [];
	const counts = await countLiveSessions(seats, {
		probePid: (pid: number): void => {
			if (pid === deadPid) {
				failure("ESRCH");
			}
		},
		readCommands: (pids: readonly number[]): ReadonlyMap<number, string> => {
			asked.push(pids);
			return new Map([
				[livePid, "claude CLAUDE_CONFIG_DIR=/fixture/.claude-dev2"],
				[otherPid, "claude HOME=/fixture"],
			]);
		},
		readDirectory: (file: string): readonly string[] => {
			if (file === directory) {
				return [key(otherPid)];
			}
			strictEqual(file, shared);
			return [key(livePid), `${livePid}.json`, key(deadPid), key(vanishedPid)];
		},
		// The dev seat keeps its own registry; the other seats link theirs to the shared one.
		resolveDirectory: (file: string): string => {
			if (file === path.join(directory, "sessions")) {
				return directory;
			}
			return shared;
		},
	});
	deepStrictEqual(
		counts,
		new Map([
			["main", zero],
			["dev2", one],
			["dev3", zero],
			["dev", one],
		]),
	);
	deepStrictEqual(asked, [[livePid, vanishedPid]]);
});

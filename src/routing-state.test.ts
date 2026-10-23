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
import type { Claim, RoutingSeat } from "./router.ts";
import { healthy, now, row } from "./router-test-fixture.ts";
import type { ClaimsResult, RoutingStateIo } from "./routing-audit.ts";
import { recordDecision } from "./routing-audit.ts";
import { parseClaims } from "./routing-files.ts";
import { routeWithState } from "./routing-state.ts";

const zero = 0;
const one = 1;
const expiredAt = 90_000;
const privateMode = 0o600;
const modeBase = 0o1000;
const privateText = "private diagnostic";
const unavailable = { ok: false, reason: "routing state unavailable" };
const readHealthy = (): readonly RoutingSeat[] => healthy;
const empty = (): ClaimsResult => ({ claims: [], ok: true });
const success = (): boolean => true;
const unexpected = (): never => {
	throw new TypeError("Unexpected I/O");
};
const failed = (): never => {
	throw new Error(privateText);
};
const defaultIo: RoutingStateIo = {
	append: success,
	read: empty,
	write: success,
};
type Context = Readonly<Pick<TestContext, "after">>;
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-routing-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	return directory;
};

await test("claims reject malformed external state and project away unrelated fields", (): void => {
	deepStrictEqual(
		parseClaims(
			JSON.stringify([{ createdAt: now, private: privateText, seat: "main" }]),
		),
		{ claims: [{ createdAt: now, seat: "main" }], ok: true },
	);
	for (const text of [
		"{",
		"null",
		"{}",
		"[null]",
		'[{"seat":"../api","createdAt":100}]',
		'[{"seat":"main","createdAt":-1}]',
		'[{"seat":"main","createdAt":1.5}]',
		'[{"seat":"main","createdAt":"1"}]',
		'[{"seat":"main","createdAt":1e999}]',
		'[{"seat":"main"}]',
	]) {
		deepStrictEqual(parseClaims(text), { ok: false });
	}
});

await test("expired claims are dropped and reservation is written before the audit line", async (): Promise<void> => {
	const events: string[] = [];
	const saved: Claim[][] = [];
	const result = await recordDecision(
		healthy,
		{
			append: (line: string): boolean => {
				events.push("log");
				strictEqual(line.split("\n").length, one + one);
				return true;
			},
			read: (): ClaimsResult => ({
				claims: [
					{ createdAt: expiredAt, seat: "main" },
					{ createdAt: now, seat: "dev" },
				],
				ok: true,
			}),
			write: (claims: readonly Claim[]): boolean => {
				events.push("claim");
				saved.push([...claims]);
				return true;
			},
		},
		{ now },
	);
	ok(result.ok);
	strictEqual(result.decision.seat, "main");
	deepStrictEqual(events, ["claim", "log"]);
	deepStrictEqual(saved, [
		[
			{ createdAt: now, seat: "dev" },
			{ createdAt: now, seat: "main" },
		],
	]);
});

await test("audit projections cannot leak extra input properties or usage metadata", async (): Promise<void> => {
	const extra = {
		...row("main"),
		accessToken: privateText,
		metadata: privateText,
	};
	const logs: string[] = [];
	const result = await recordDecision(
		[extra],
		{
			...defaultIo,
			append: (line: string): boolean => {
				logs.push(line);
				return true;
			},
		},
		{ now },
	);
	ok(result.ok);
	strictEqual(logs.length, one);
	strictEqual(logs.join("").includes(privateText), false);
	strictEqual(logs.join("").includes("accessToken"), false);
});

await test("read, claim, and log failures return safe errors without granting launch", async (): Promise<void> => {
	await Promise.all(
		[
			{ append: unexpected, read: failed, write: unexpected },
			{
				append: unexpected,
				read: (): ClaimsResult => ({ ok: false }),
				write: unexpected,
			},
			{ ...defaultIo, append: unexpected, write: (): boolean => false },
			{ ...defaultIo, append: (): boolean => false },
			{ ...defaultIo, append: failed },
		].map(async (io: RoutingStateIo): Promise<void> => {
			deepStrictEqual(await recordDecision(healthy, io, { now }), unavailable);
		}),
	);
});

await test("refusals are audited without reserving a seat", async (): Promise<void> => {
	let logged = zero;
	const result = await recordDecision(
		[row("main", { fiveHour: 100 })],
		{
			append: (): boolean => {
				logged += one;
				return true;
			},
			read: empty,
			write: unexpected,
		},
		{ now },
	);
	ok(result.ok);
	strictEqual(result.decision.seat, "none");
	strictEqual(logged, one);
});

const assertPrivate = async (directory: string): Promise<void> => {
	await Promise.all(
		["claims.json", "decisions.log"].map(async (name): Promise<void> => {
			const info = await stat(path.join(directory, name));
			strictEqual(info.mode % modeBase, privateMode);
		}),
	);
	const files = await readdir(directory);
	deepStrictEqual(files.toSorted(), ["claims.json", "decisions.log"]);
};
await test("real state writes are private, expired claims clear, and the lock is released", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	await writeFile(
		path.join(directory, "claims.json"),
		JSON.stringify([{ createdAt: expiredAt, seat: "main" }]),
	);
	const result = await routeWithState(directory, readHealthy);
	ok(result.ok);
	strictEqual(result.decision.seat, "main");
	await assertPrivate(directory);
	const claims = parseClaims(
		await readFile(path.join(directory, "claims.json"), "utf8"),
	);
	ok(claims.ok);
	strictEqual(claims.claims.length, one);
});

await test("an unwritable log releases the lock and subsequent launches can recover", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const log = path.join(directory, "decisions.log");
	await mkdir(log);
	deepStrictEqual(await routeWithState(directory, readHealthy), unavailable);
	await rm(log, { recursive: true });
	const result = await routeWithState(directory, readHealthy);
	ok(result.ok);
	strictEqual(result.decision.seat, "dev");
	await assertPrivate(directory);
});

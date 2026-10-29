import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { healthy } from "./router-test-fixture.ts";
import { parseClaims } from "./routing-files.ts";
import { routeWithState } from "./routing-state.ts";

const one = 1;
// Above macOS and Linux pid_max, so no process can hold it.
const deadPid = 2_147_483_647;
const privateMode = 0o600;
const modeBase = 0o1000;
const unexpected = (): never => {
	throw new TypeError("Unexpected I/O");
};
type Context = Readonly<Pick<TestContext, "after">>;
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-lock-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	await mkdir(path.join(directory, "routing.lock"));
	return directory;
};
const assertFiles = async (
	directory: string,
	expected: readonly string[],
): Promise<void> => {
	const files = await readdir(directory);
	deepStrictEqual(files.toSorted(), expected);
};
const assertManualAudit = async (directory: string): Promise<void> => {
	const file = path.join(directory, "decisions.log");
	const log = await readFile(file, "utf8");
	const entry: unknown = JSON.parse(log);
	ok(typeof entry === "object" && entry !== null && "at" in entry);
	ok(typeof entry.at === "number");
	deepStrictEqual(entry, {
		at: entry.at,
		mode: "manual",
		reason: "manual",
		reservation: "skipped: routing busy",
		rows: [],
		seat: "dev2",
	});
	strictEqual(log.split("\n").length, one + one);
	const info = await stat(file);
	strictEqual(info.mode % modeBase, privateMode);
};
const seedSharedState = async (
	directory: string,
): Promise<() => Promise<void>> => {
	const lock = path.join(directory, "routing.lock");
	const claimsFile = path.join(directory, "claims.json");
	const claims = JSON.stringify([{ createdAt: Date.now(), seat: "main" }]);
	const lockBefore = await stat(lock);
	await writeFile(claimsFile, claims);
	return async (): Promise<void> => {
		strictEqual(await readFile(claimsFile, "utf8"), claims);
		deepStrictEqual(await stat(lock), lockBefore);
	};
};

await test("a fresh lock times out without stealing it or reading seats", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	deepStrictEqual(await routeWithState(directory, unexpected), {
		ok: false,
		reason: "routing busy; check routing.lock in the state directory",
	});
	await assertFiles(directory, ["routing.lock"]);
});

await test("a fresh lock whose owner process died is recovered at once", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	await mkdir(
		path.join(
			directory,
			"routing.lock",
			`owner-${String(deadPid)}-${randomUUID()}`,
		),
	);
	const result = await routeWithState(directory, () => healthy);
	ok(result.ok);
	await assertFiles(directory, ["claims.json", "decisions.log"]);
});

await test("concurrent selectors recover an aged orphan lock and keep distinct reservations", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const old = new Date("2000-01-01T00:00:00Z");
	await utimes(path.join(directory, "routing.lock"), old, old);
	const results = await Promise.all(
		healthy.map(async () => routeWithState(directory, () => healthy)),
	);
	for (const result of results) {
		ok(result.ok);
	}
	const claims = parseClaims(
		await readFile(path.join(directory, "claims.json"), "utf8"),
	);
	ok(claims.ok);
	deepStrictEqual(claims.claims.map((claim) => claim.seat).toSorted(), [
		"dev",
		"dev2",
		"dev3",
		"main",
	]);
	await assertFiles(directory, ["claims.json", "decisions.log"]);
});

await test("manual overrides bypass a busy lock, audit the missing reservation, and preserve shared state", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const assertUnchanged = await seedSharedState(directory);
	const result = await routeWithState(directory, unexpected, "dev2");
	ok(result.ok);
	deepStrictEqual(result.decision, {
		mode: "manual",
		reason: "manual",
		rows: [],
		seat: "dev2",
	});
	await assertManualAudit(directory);
	await assertUnchanged();
});

await test("a manual bypass still requires an audit and leaves the busy lock intact on failure", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	await mkdir(path.join(directory, "decisions.log"));
	deepStrictEqual(await routeWithState(directory, unexpected, "dev2"), {
		ok: false,
		reason: "routing state unavailable",
	});
	await assertFiles(directory, ["decisions.log", "routing.lock"]);
});

const assertConcurrentState = async (directory: string): Promise<void> => {
	const claims = parseClaims(
		await readFile(path.join(directory, "claims.json"), "utf8"),
	);
	ok(claims.ok);
	deepStrictEqual(
		claims.claims.map((claim) => claim.seat),
		["main"],
	);
	const log = await readFile(path.join(directory, "decisions.log"), "utf8");
	const seats = log
		.trimEnd()
		.split("\n")
		.map((line) => {
			const entry: unknown = JSON.parse(line);
			ok(typeof entry === "object" && entry !== null && "seat" in entry);
			ok(typeof entry.seat === "string");
			return entry.seat;
		});
	deepStrictEqual(seats.toSorted(), ["dev2", "dev3", "main"]);
	await assertFiles(directory, ["claims.json", "decisions.log"]);
};
const bypassWhileHeld = async (
	directory: string,
	entered: Readonly<Promise<boolean>>,
	resume: () => void,
): Promise<void> => {
	await entered;
	const overrides = await Promise.all([
		routeWithState(directory, unexpected, "dev2"),
		routeWithState(directory, unexpected, "dev3"),
	]).finally(resume);
	for (const override of overrides) {
		ok(override.ok);
	}
};
await test("concurrent manual bypasses preserve a live lock owner's reservation and audit", async (context: Context): Promise<void> => {
	const directory = path.join(await fixture(context), "live");
	const entered = Promise.withResolvers<boolean>();
	const resume = Promise.withResolvers<boolean>();
	const automatic = routeWithState(directory, async () => {
		const old = new Date("2000-01-01T00:00:00Z");
		await utimes(path.join(directory, "routing.lock"), old, old);
		entered.resolve(true);
		await resume.promise;
		return healthy;
	});
	await bypassWhileHeld(directory, entered.promise, () => {
		resume.resolve(true);
	});
	const result = await automatic;
	ok(result.ok);
	strictEqual(result.decision.seat, "main");
	await assertConcurrentState(directory);
});

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Context, Fixture } from "./shim-fixture.ts";
import { fixture, run } from "./shim-fixture.ts";
import type { UsageServer } from "./usage-table-fixture.ts";
import {
	assertCache,
	expireCache,
	installCredential,
	installCredentials,
	serverFixture,
	synthetic,
} from "./usage-table-fixture.ts";

const success = 0;
const seatCount = 4;
const rowParts = 5;
const doubledRequests = 8;
const one = 1;
const two = 2;
const rateLimited = 429;
const serverError = 503;

const assertFresh = async (
	setup: Fixture,
	server: UsageServer,
): Promise<void> => {
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([
			["CLAUDE_SEATS_USAGE_URL", server.url],
			["TZ", "Europe/Berlin"],
		]),
		omit: ["CLAUDE_SEATS_STATE_DIR"],
	});
	strictEqual(result.status, success);
	strictEqual(result.stderr, "returned:0\n");
	strictEqual(result.stdout.split("10% ↻17:20").length, rowParts);
	strictEqual(result.stdout.split("1% ↻Fri 13:00").length, rowParts);
	strictEqual(result.stdout.includes(synthetic), false);
	strictEqual(server.requests.length, seatCount);
};
const assertStale = async (
	setup: Fixture,
	server: UsageServer,
): Promise<void> => {
	await expireCache(path.join(setup.home, ".claude-shared/_seats"));
	server.setStatus(rateLimited);
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_USAGE_URL", server.url]]),
		omit: ["CLAUDE_SEATS_STATE_DIR"],
	});
	strictEqual(result.status, success);
	strictEqual(result.stdout.split("(cached 3m ago)").length, rowParts);
	strictEqual(server.requests.length, doubledRequests);
	strictEqual(result.stdout.includes(synthetic), false);
};
const assertFailure = async (
	setup: Fixture,
	server: UsageServer,
	reason: string,
): Promise<void> => {
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_USAGE_URL", server.url]]),
	});
	strictEqual(result.status, success);
	ok(result.stdout.includes(`? (${reason})`));
	strictEqual(result.stdout.split("not logged in").length, seatCount);
	strictEqual(result.stdout.includes(synthetic), false);
	strictEqual(result.stderr, "returned:0\n");
};

const readCacheContents = async (state: string): Promise<readonly string[]> => {
	const files = await readdir(state);
	return Promise.all(
		files
			.toSorted()
			.map(async (file) => readFile(path.join(state, file), "utf8")),
	);
};

const assertInvalidCached = async (
	setup: Fixture,
	server: UsageServer,
): Promise<void> => {
	const state = path.join(setup.home, ".claude-shared/_seats");
	await expireCache(state);
	const before = await readCacheContents(state);
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([
			["CLAUDE_SEATS_USAGE_URL", server.url],
			["TZ", "Europe/Berlin"],
		]),
		omit: ["CLAUDE_SEATS_STATE_DIR"],
	});
	strictEqual(result.status, success);
	strictEqual(result.stderr, "returned:0\n");
	strictEqual(
		result.stdout.split("1% ↻Fri 13:00 (cached 3m ago)").length,
		rowParts,
	);
	deepStrictEqual(await readCacheContents(state), before);
	strictEqual(result.stdout.includes(synthetic), false);
};

const assertInvalidUncached = async (
	setup: Fixture,
	server: UsageServer,
): Promise<void> => {
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_USAGE_URL", server.url]]),
		omit: ["CLAUDE_SEATS_STATE_DIR"],
	});
	strictEqual(result.status, success);
	strictEqual(result.stderr, "returned:0\n");
	strictEqual(result.stdout.split("? (invalid response)").length, rowParts);
	strictEqual(result.stdout.includes(synthetic), false);
};

await test("cc @ uses all seat credentials, local clocks, default shared cache and zero requests on a second invocation", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const server = await serverFixture(context);
	await installCredentials(setup);
	await assertFresh(setup, server);
	await assertFresh(setup, server);
	for (const request of server.requests) {
		deepStrictEqual(request, {
			authorized: true,
			beta: "oauth-2025-04-20",
			method: "GET",
			seat: request.seat,
			url: "/api/oauth/usage",
		});
	}
	deepStrictEqual(server.requests.map((request) => request.seat).toSorted(), [
		"dev",
		"dev2",
		"dev3",
		"main",
	]);
	await assertCache(path.join(setup.home, ".claude-shared/_seats"));
	await assertStale(setup, server);
});

await test("cc @ isolates missing credentials and shows HTTP errors with exit zero and no private response text", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const server = await serverFixture(context);
	await installCredential(setup, "main");
	server.setStatus(rateLimited);
	await assertFailure(setup, server, "HTTP 429");
	server.setStatus(serverError);
	await assertFailure(setup, server, "HTTP 5xx");
	strictEqual(server.requests.length, two);
});

await test("cc @ times out a stalled endpoint and stops requests after logout", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const server = await serverFixture(context);
	await installCredential(setup, "main");
	server.stall();
	await assertFailure(setup, server, "timeout");
	await rm(path.join(setup.keychain, "Claude Code-credentials.json"));
	const missing = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_USAGE_URL", server.url]]),
	});
	strictEqual(missing.status, success);
	strictEqual(missing.stdout.split("not logged in").length, rowParts);
	strictEqual(server.requests.length, one);
});

await test("cc @ writes successful results to the state directory override", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const server = await serverFixture(context);
	await installCredentials(setup);
	const result = await run(setup, ["@"], {
		env: Object.fromEntries([["CLAUDE_SEATS_USAGE_URL", server.url]]),
	});
	strictEqual(result.status, success);
	await assertCache(path.join(setup.directory, "state"));
});

await test("cc @ preserves last-good cache on impossible reset dates and reports invalid responses without cache", async (context: Context): Promise<void> => {
	const setup = await fixture(context);
	const server = await serverFixture(context);
	await installCredentials(setup);
	await assertFresh(setup, server);
	server.setBody(
		'{"five_hour":{"resets_at":"2026-02-30T15:20:00Z","utilization":99},"seven_day":null}',
	);
	await assertInvalidCached(setup, server);
	await rm(path.join(setup.home, ".claude-shared/_seats"), { recursive: true });
	await assertInvalidUncached(setup, server);
});

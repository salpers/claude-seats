import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type { UsageFetch, UsageFetchOptions } from "./usage-client.ts";
import { fetchUsage } from "./usage-client.ts";
import { responseBody, synthetic, usage } from "./usage-test-fixture.ts";

const one = 1;
const timeoutMs = 10;
const stallMs = 1000;
const cases: readonly Readonly<{ status: number; reason: string }>[] = [
	{ reason: "HTTP 429", status: 429 },
	{ reason: "HTTP 5xx", status: 500 },
	{ reason: "HTTP 5xx", status: 503 },
	{ reason: "HTTP 401/403", status: 401 },
	{ reason: "HTTP 401/403", status: 403 },
	{ reason: "HTTP 4xx", status: 404 },
	{ reason: "HTTP error", status: 302 },
];
const stalledFetch: UsageFetch = async (
	_url: string,
	options: UsageFetchOptions,
): Promise<Response> => {
	await setTimeout(stallMs, "", { signal: options.signal });
	return new Response(responseBody);
};

await test("usage requests use the base override, bearer header, beta header and a bounded signal", async (): Promise<void> => {
	let calls = 0;
	const fetch: UsageFetch = (
		url: string,
		options: UsageFetchOptions,
	): Response => {
		calls += one;
		strictEqual(url, "http://localhost:1234/proxy/api/oauth/usage");
		strictEqual(
			options.headers["authorization"] === `Bearer ${synthetic}`,
			true,
		);
		strictEqual(options.headers["anthropic-beta"], "oauth-2025-04-20");
		strictEqual(options.method, "GET");
		strictEqual(options.redirect, "error");
		strictEqual(options.signal.aborted, false);
		return new Response(responseBody);
	};
	deepStrictEqual(
		await fetchUsage(synthetic, {
			baseUrl: "http://localhost:1234/proxy/",
			fetch,
		}),
		{ ok: true, usage },
	);
	strictEqual(calls, one);
	await fetchUsage(synthetic, {
		fetch: (url: string): Response => {
			strictEqual(url, "https://api.anthropic.com/api/oauth/usage");
			return new Response(responseBody);
		},
	});
});

await test("HTTP failures are classified without reading untrusted bodies", async (): Promise<void> => {
	await Promise.all(
		cases.map(async ({ status, reason }): Promise<void> => {
			const fetch: UsageFetch = (): Response =>
				new Response(synthetic, { status });
			deepStrictEqual(await fetchUsage(synthetic, { fetch }), {
				ok: false,
				reason,
			});
		}),
	);
});

await test("network, timeout, malformed JSON and schema failures return only safe classes", async (): Promise<void> => {
	await Promise.all(
		[
			{ name: "Error", reason: "network error" },
			{ name: "TimeoutError", reason: "timeout" },
			{ name: "AbortError", reason: "timeout" },
		].map(
			async ({
				name,
				reason,
			}: Readonly<{ name: string; reason: string }>): Promise<void> => {
				const fetch: UsageFetch = (): never => {
					throw Object.assign(new Error(synthetic), { name });
				};
				deepStrictEqual(await fetchUsage(synthetic, { fetch }), {
					ok: false,
					reason,
				});
			},
		),
	);
	await Promise.all(
		[synthetic, "{}", "null", "[]"].map(async (text): Promise<void> => {
			deepStrictEqual(
				await fetchUsage(synthetic, {
					fetch: (): Response => new Response(text),
				}),
				{ ok: false, reason: "invalid response" },
			);
		}),
	);
});

await test("a stalled request receives the configured timeout signal", async (): Promise<void> => {
	deepStrictEqual(
		await fetchUsage(synthetic, { fetch: stalledFetch, timeoutMs }),
		{ ok: false, reason: "timeout" },
	);
});

await test("invalid base URLs never send credentials or expose the supplied URL", async (): Promise<void> => {
	await Promise.all(
		[
			"invalid",
			"file:///private",
			"http://example.com/collector",
			"http://192.168.1.2",
			"http://[2001:db8::1]",
			"http://localhost.example.com",
			"http://127.0.0.1.example.com",
			"http://localhost@evil.example",
			"http://127.0.0.1/?private=value",
			"http://localhost/#private",
			"https://user@example.com",
			"https://example.com/?private=value",
			"https://example.com/#private",
		].map(async (baseUrl): Promise<void> => {
			deepStrictEqual(
				await fetchUsage(synthetic, {
					baseUrl,
					fetch: (): never => {
						throw new TypeError("Unexpected request");
					},
				}),
				{ ok: false, reason: "invalid usage URL" },
			);
		}),
	);
});

await test("HTTPS endpoints and only loopback HTTP endpoints can receive usage requests", async (): Promise<void> => {
	await Promise.all(
		[
			"https://example.com/proxy",
			"http://127.0.0.1:1234",
			"http://localhost:1234",
			"http://[::1]:1234",
		].map(async (baseUrl): Promise<void> => {
			let calls = 0;
			const result = await fetchUsage(synthetic, {
				baseUrl,
				fetch: (url: string): Response => {
					calls += one;
					strictEqual(url, `${baseUrl}/api/oauth/usage`);
					return new Response(responseBody);
				},
			});
			deepStrictEqual(result, { ok: true, usage });
			strictEqual(calls, one);
		}),
	);
});

import type { Usage } from "./usage.ts";
import { parseUsage } from "./usage.ts";

type UsageError =
	| "HTTP 429"
	| "HTTP 5xx"
	| "HTTP 401/403"
	| "HTTP 4xx"
	| "HTTP error"
	| "timeout"
	| "network error"
	| "invalid response"
	| "invalid usage URL";
type UsageReply =
	| { readonly ok: true; readonly usage: Usage }
	| { readonly ok: false; readonly reason: UsageError };
interface UsageFetchOptions {
	readonly headers: Readonly<Record<string, string>>;
	readonly method: "GET";
	readonly redirect: "error";
	readonly signal: Readonly<AbortSignal>;
}
type UsageFetch = (
	url: string,
	options: UsageFetchOptions,
) =>
	| Readonly<Pick<Response, "status" | "json">>
	| Promise<Readonly<Pick<Response, "status" | "json">>>;

const trailingSlash = /\/$/u;
const defaultBase = "https://api.anthropic.com";
const defaultTimeout = 5000;
const success = 200;
const redirect = 300;
const unauthorized = 401;
const forbidden = 403;
const rateLimited = 429;
const clientError = 400;
const serverError = 500;
const statusLimit = 600;

const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);

const endpointUrl = (base: string): string | false => {
	try {
		const url = new URL(base);
		if (
			(url.protocol !== "https:" && url.protocol !== "http:") ||
			(url.protocol === "http:" && !loopbackHosts.has(url.hostname)) ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== ""
		) {
			return false;
		}
		url.pathname = `${url.pathname.replace(trailingSlash, "")}/api/oauth/usage`;
		return url.href;
	} catch {
		return false;
	}
};

const httpError = (status: number): UsageError => {
	if (status === rateLimited) {
		return "HTTP 429";
	}
	if (status >= serverError && status < statusLimit) {
		return "HTTP 5xx";
	}
	if (status === unauthorized || status === forbidden) {
		return "HTTP 401/403";
	}
	if (status >= clientError && status < serverError) {
		return "HTTP 4xx";
	}
	return "HTTP error";
};

const decodeResponse = async (
	response: Readonly<Pick<Response, "status" | "json">>,
	signal: Readonly<AbortSignal>,
): Promise<UsageReply> => {
	if (response.status < success || response.status >= redirect) {
		return { ok: false, reason: httpError(response.status) };
	}
	try {
		const value: unknown = await response.json();
		return parseUsage(value);
	} catch {
		if (signal.aborted) {
			return { ok: false, reason: "timeout" };
		}
		return { ok: false, reason: "invalid response" };
	}
};

const requestUsage = async (
	url: string | false,
	accessToken: string,
	{ request, timeoutMs }: Readonly<{ request: UsageFetch; timeoutMs: number }>,
): Promise<UsageReply> => {
	if (url === false) {
		return { ok: false, reason: "invalid usage URL" };
	}
	const signal = AbortSignal.timeout(timeoutMs);
	try {
		const response = await request(url, {
			headers: {
				"anthropic-beta": "oauth-2025-04-20",
				authorization: `Bearer ${accessToken}`,
			},
			method: "GET",
			// Redirects must never forward a seat credential to another endpoint.
			redirect: "error",
			signal,
		});
		return await decodeResponse(response, signal);
	} catch (error: unknown) {
		if (
			signal.aborted ||
			(error instanceof Error &&
				(error.name === "TimeoutError" || error.name === "AbortError"))
		) {
			return { ok: false, reason: "timeout" };
		}
		return { ok: false, reason: "network error" };
	}
};

const fetchUsage = async (
	accessToken: string,
	{
		baseUrl = defaultBase,
		fetch: request = globalThis.fetch,
		timeoutMs = defaultTimeout,
	}: Readonly<{
		baseUrl?: string | undefined;
		fetch?: UsageFetch;
		timeoutMs?: number;
	}> = {},
): Promise<UsageReply> =>
	requestUsage(endpointUrl(baseUrl), accessToken, { request, timeoutMs });

export type { UsageError, UsageFetch, UsageFetchOptions, UsageReply };
export { fetchUsage };

import { ok, strictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import path from "node:path";
import type { Context, Fixture } from "./shim-fixture.ts";

const rawUsage =
	'{"five_hour":{"resets_at":"2026-09-18T15:20:00Z","utilization":10},"seven_day":{"resets_at":"2026-09-25T11:00:00Z","utilization":1}}';
const storedUsage = {
	fiveHour: { resetAt: "2026-09-18T15:20:00.000Z", utilization: 10 },
	sevenDay: { resetAt: "2026-09-25T11:00:00.000Z", utilization: 1 },
};
const synthetic = "fixture credential";
const privateMode = 0o600;
const modeBase = 0o1000;
const automaticPort = 0;
const suffixLength = 8;
const start = 0;
const seatCount = 4;
const staleAge = 180_000;
const seatNames: readonly string[] = ["main", "dev", "dev2", "dev3"];

interface UsageRequest {
	readonly headers: Readonly<{
		authorization?: string | undefined;
		"anthropic-beta"?: string | readonly string[] | undefined;
	}>;
	readonly method?: string | undefined;
	readonly url?: string | undefined;
}
interface RequestRecord {
	readonly authorized: boolean;
	readonly beta: string | readonly string[] | undefined;
	readonly method: string | undefined;
	readonly seat: string;
	readonly url: string | undefined;
}
interface UsageServer {
	readonly requests: readonly RequestRecord[];
	readonly setBody: (value: string) => void;
	readonly setStatus: (value: number) => void;
	readonly stall: () => void;
	readonly url: string;
}

const requestRecord = (request: UsageRequest): RequestRecord => {
	const seat =
		seatNames.find(
			(name) => request.headers.authorization === `Bearer ${synthetic} ${name}`,
		) ?? "unknown";
	return {
		authorized: seat !== "unknown",
		beta: request.headers["anthropic-beta"],
		method: request.method,
		seat,
		url: request.url,
	};
};

const serverFixture = async (context: Context): Promise<UsageServer> => {
	const requests: RequestRecord[] = [];
	const behavior = { body: rawUsage, hang: false, status: 200 };
	const server = createServer(
		(
			request: UsageRequest,
			response: Readonly<Pick<ServerResponse, "writeHead" | "end">>,
		): void => {
			requests.push(requestRecord(request));
			if (behavior.hang) {
				return;
			}
			response.writeHead(behavior.status, {
				"Content-Type": "application/json",
			});
			response.end(
				behavior.body.replace(
					'"five_hour":',
					`"obfuscated":${JSON.stringify(synthetic)},"five_hour":`,
				),
			);
		},
	);
	context.after(async (): Promise<void> => {
		server.closeAllConnections();
		const closed = once(server, "close");
		server.close();
		await closed;
	});
	server.listen(automaticPort, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	ok(address !== null && typeof address !== "string");
	return {
		requests,
		setBody: (value: string): void => {
			behavior.body = value;
		},
		setStatus: (value: number): void => {
			behavior.status = value;
		},
		stall: (): void => {
			behavior.hang = true;
		},
		url: `http://127.0.0.1:${address.port}`,
	};
};

const slotFor = (setup: Fixture, name: string): string => {
	if (name === "main") {
		return "Claude Code-credentials";
	}
	const hash = createHash("sha256")
		.update(path.join(setup.home, `.claude-${name}`))
		.digest("hex")
		.slice(start, suffixLength);
	return `Claude Code-credentials-${hash}`;
};
const installCredential = async (
	setup: Fixture,
	name: string,
): Promise<void> => {
	await writeFile(
		path.join(setup.keychain, `${slotFor(setup, name)}.json`),
		JSON.stringify({ claudeAiOauth: { accessToken: `${synthetic} ${name}` } }),
		{ mode: privateMode },
	);
};
const installCredentials = async (setup: Fixture): Promise<void> => {
	await Promise.all(
		seatNames.map(
			async (seat): Promise<void> => installCredential(setup, seat),
		),
	);
};
const assertCacheFile = async (file: string): Promise<void> => {
	const { mode } = await stat(file);
	strictEqual(mode % modeBase, privateMode);
	const text = await readFile(file, "utf8");
	strictEqual(text.includes(synthetic), false);
	strictEqual(text.includes("accessToken"), false);
};
const assertCache = async (state: string): Promise<void> => {
	const files = await readdir(state);
	strictEqual(files.length, seatCount);
	await Promise.all(
		files.map(
			async (file): Promise<void> => assertCacheFile(path.join(state, file)),
		),
	);
};
const expireCache = async (state: string): Promise<void> => {
	await Promise.all(
		seatNames.map(async (seat): Promise<void> => {
			await writeFile(
				path.join(state, `usage-${seat}.json`),
				JSON.stringify({
					fetchedAt: Date.now() - staleAge,
					usage: storedUsage,
				}),
				{ mode: privateMode },
			);
		}),
	);
};

export type { UsageServer };
export {
	assertCache,
	expireCache,
	installCredential,
	installCredentials,
	serverFixture,
	synthetic,
};

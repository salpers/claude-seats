import type { Credential } from "./oauth.ts";
import type { Usage } from "./usage.ts";
import type { CacheResult, UsageCache, UsageSnapshot } from "./usage-cache.ts";
import type { UsageReply } from "./usage-client.ts";

const usage: Usage = {
	fiveHour: { resetAt: "2026-09-18T15:20:00.000Z", utilization: 10 },
	sevenDay: { resetAt: "2026-09-25T11:00:00.000Z", utilization: 1 },
};
const responseBody =
	'{"five_hour":{"resets_at":"2026-09-18T15:20:00Z","utilization":10},"seven_day":{"resets_at":"2026-09-25T11:00:00Z","utilization":1}}';
const synthetic = "test credential";
const credentialText = JSON.stringify({
	claudeAiOauth: { accessToken: synthetic, refreshToken: "unused" },
});
const unexpected = (): never => {
	throw new TypeError("Unexpected I/O");
};
const credential = (): Credential => ({ accessToken: synthetic, ok: true });
const emptyCache = (): CacheResult => ({ ok: false });
const goodReply = (): UsageReply => ({ ok: true, usage });
const writeFailure = (): boolean => false;
const snapshot: UsageSnapshot = { fetchedAt: 1000, usage };
const fixtureCache: UsageCache = { read: emptyCache, write: writeFailure };
const cacheHit = (value: UsageSnapshot): CacheResult => ({
	ok: true,
	snapshot: value,
});

export {
	cacheHit,
	credential,
	credentialText,
	emptyCache,
	fixtureCache,
	goodReply,
	responseBody,
	snapshot,
	synthetic,
	unexpected,
	usage,
};

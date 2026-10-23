import type { CredentialPresence } from "./credentials.ts";
import type { Credential, CredentialError } from "./oauth.ts";
import type { SeatName } from "./seats.ts";
import type { Usage } from "./usage.ts";
import type { CacheResult, UsageCache } from "./usage-cache.ts";
import type { UsageError, UsageReply } from "./usage-client.ts";

type SeatUsage =
	| { readonly ok: true; readonly usage: Usage; readonly cachedAgeMs: number }
	| { readonly ok: false; readonly reason: UsageError | CredentialError };

interface ProbeOptions {
	readonly cache: UsageCache;
	readonly readCredential: () => Credential | Promise<Credential>;
	readonly request: (accessToken: string) => UsageReply | Promise<UsageReply>;
	readonly now?: () => number;
}
const freshMs = 60_000;
const fallbackMs = 600_000;
const zero = 0;

const cachedUsage = (cached: CacheResult, now: number): SeatUsage => {
	if (cached.ok) {
		const age = now - cached.snapshot.fetchedAt;
		if (age >= zero && age <= fallbackMs) {
			return { cachedAgeMs: age, ok: true, usage: cached.snapshot.usage };
		}
	}
	return { ok: false, reason: "invalid response" };
};

const fallbackUsage = (
	cached: SeatUsage,
	result: Extract<UsageReply, { ok: false }>,
): SeatUsage => {
	if (cached.ok) {
		return cached;
	}
	return result;
};

const refresh = async (
	seat: SeatName,
	cached: CacheResult,
	{ cache, readCredential, request, now = Date.now }: ProbeOptions,
): Promise<SeatUsage> => {
	const credential = await readCredential();
	if (!credential.ok) {
		return credential;
	}
	const result = await request(credential.accessToken);
	if (result.ok) {
		await cache.write(seat, { fetchedAt: now(), usage: result.usage });
		return { cachedAgeMs: zero, ok: true, usage: result.usage };
	}
	return fallbackUsage(cachedUsage(cached, now()), result);
};

const probeSeatUsage = async (
	seat: SeatName,
	presence: CredentialPresence,
	options: ProbeOptions,
): Promise<SeatUsage> => {
	if (!presence.ok) {
		return { ok: false, reason: "credential unavailable" };
	}
	if (!presence.present) {
		return { ok: false, reason: "not logged in" };
	}
	const cached = await options.cache.read(seat);
	const lastGood = cachedUsage(cached, (options.now ?? Date.now)());
	if (lastGood.ok && lastGood.cachedAgeMs < freshMs) {
		return { ...lastGood, cachedAgeMs: zero };
	}
	return refresh(seat, cached, options);
};

export type { ProbeOptions, SeatUsage };
export { probeSeatUsage };

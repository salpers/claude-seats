import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { CredentialPresence } from "./credentials.ts";
import type { Credential, CredentialError } from "./oauth.ts";
import type { SeatName } from "./seats.ts";
import type { CacheResult, UsageSnapshot } from "./usage-cache.ts";
import type { UsageError, UsageReply } from "./usage-client.ts";
import type { ProbeOptions } from "./usage-probe.ts";
import { probeSeatUsage } from "./usage-probe.ts";
import {
	cacheHit,
	credential,
	emptyCache,
	fixtureCache,
	goodReply,
	unexpected,
	usage,
} from "./usage-test-fixture.ts";

const present: CredentialPresence = { ok: true, present: true };
const one = 1;
const three = 3;
const beforeExpiry = 59_999;
const threeMinutes = 180_000;
const tenMinutes = 600_000;
const tooOld = 600_001;
const future = -1;
const zero = 0;
const now = 1_000_000;
const errors: readonly UsageError[] = ["HTTP 429", "HTTP 5xx", "timeout"];
const credentialErrors: readonly CredentialError[] = [
	"not logged in",
	"invalid credential",
	"credential unavailable",
];

interface ProbeFixture {
	readonly advance: (ms: number) => void;
	readonly counts: { readonly calls: number; readonly reads: number };
	readonly options: ProbeOptions;
}
const probeFixture = (): ProbeFixture => {
	let clock = now;
	const counts = { calls: 0, reads: 0 };
	const snapshots = new Map<SeatName, UsageSnapshot>();
	const options = {
		cache: {
			read: (seat: SeatName): CacheResult => {
				const stored = snapshots.get(seat);
				if (stored) {
					return cacheHit(stored);
				}
				return { ok: false };
			},
			write: (seat: SeatName, value: UsageSnapshot): boolean => {
				snapshots.set(seat, value);
				return true;
			},
		},
		now: (): number => clock,
		readCredential: (): Credential => {
			counts.reads += one;
			return credential();
		},
		request: (): UsageReply => {
			counts.calls += one;
			return goodReply();
		},
	};
	return {
		advance: (ms: number): void => {
			clock += ms;
		},
		counts,
		options,
	};
};

await test("repeated probes make zero requests inside 60 seconds and refresh at the boundary per seat", async (): Promise<void> => {
	const setup = probeFixture();
	deepStrictEqual(await probeSeatUsage("main", present, setup.options), {
		cachedAgeMs: 0,
		ok: true,
		usage,
	});
	await probeSeatUsage("main", present, setup.options);
	setup.advance(beforeExpiry);
	await probeSeatUsage("main", present, setup.options);
	deepStrictEqual(setup.counts, { calls: 1, reads: 1 });
	setup.advance(one);
	await probeSeatUsage("main", present, setup.options);
	await probeSeatUsage("dev", present, setup.options);
	strictEqual(setup.counts.calls, three);
});

await test("HTTP errors and timeouts use last-good cache up to ten minutes without overwriting it", async (): Promise<void> => {
	await Promise.all(
		errors.flatMap((reason) =>
			[threeMinutes, tenMinutes, tooOld, future].map(
				async (age): Promise<void> => {
					const result = await probeSeatUsage("main", present, {
						cache: {
							read: (): CacheResult =>
								cacheHit({ fetchedAt: now - age, usage }),
							write: unexpected,
						},
						now: (): number => now,
						readCredential: credential,
						request: (): UsageReply => ({ ok: false, reason }),
					});
					if (age >= zero && age <= tenMinutes) {
						deepStrictEqual(result, { cachedAgeMs: age, ok: true, usage });
					} else {
						deepStrictEqual(result, { ok: false, reason });
					}
				},
			),
		),
	);
	await Promise.all(
		errors.map(async (reason): Promise<void> => {
			deepStrictEqual(
				await probeSeatUsage("main", present, {
					cache: { read: emptyCache, write: unexpected },
					readCredential: credential,
					request: (): UsageReply => ({ ok: false, reason }),
				}),
				{ ok: false, reason },
			);
		}),
	);
});

await test("missing or inaccessible credentials never reuse cached account data or request usage", async (): Promise<void> => {
	const options = {
		cache: { read: unexpected, write: unexpected },
		readCredential: unexpected,
		request: unexpected,
	};
	deepStrictEqual(
		await probeSeatUsage("main", { ok: true, present: false }, options),
		{ ok: false, reason: "not logged in" },
	);
	deepStrictEqual(
		await probeSeatUsage("main", { ok: false, reason: "private" }, options),
		{ ok: false, reason: "credential unavailable" },
	);
	await Promise.all(
		credentialErrors.map(async (reason): Promise<void> => {
			deepStrictEqual(
				await probeSeatUsage("main", present, {
					...options,
					cache: { read: emptyCache, write: unexpected },
					readCredential: (): Credential => ({ ok: false, reason }),
				}),
				{ ok: false, reason },
			);
		}),
	);
});

await test("cache write failure does not discard successful numbers", async (): Promise<void> => {
	deepStrictEqual(
		await probeSeatUsage("main", present, {
			cache: fixtureCache,
			readCredential: credential,
			request: goodReply,
		}),
		{ cachedAgeMs: 0, ok: true, usage },
	);
});

await test("last-good cache expires while an endpoint request is in flight", async (): Promise<void> => {
	let clock = now;
	const result = await probeSeatUsage("main", present, {
		cache: {
			read: (): CacheResult => cacheHit({ fetchedAt: now - tenMinutes, usage }),
			write: unexpected,
		},
		now: (): number => clock,
		readCredential: credential,
		request: (): UsageReply => {
			clock += one;
			return { ok: false, reason: "timeout" };
		},
	});
	deepStrictEqual(result, { ok: false, reason: "timeout" });
});

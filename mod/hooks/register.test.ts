import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { SeatsApi } from "./register.ts";
import { handOff, showLimits } from "./register.ts";

const sessionId = "11111111-2222-4333-8444-555555555555";
const handoffFile = "/tmp/cc-seat.test";
interface Calls {
	readonly ran: string[];
	readonly statuses: string[];
	readonly writes: (readonly [string, string])[];
}

const resolved = async <Value>(value: Value): Promise<Value> => {
	await Promise.resolve();
	return value;
};

// A session that cc started on dev; it records what the mod asks Claude Code to do.
const fakeSession = (): Readonly<{ api: SeatsApi; calls: Calls }> => {
	const env: Readonly<Record<string, string>> = Object.fromEntries([
		["CLAUDE_SEATS_CURRENT", "dev"],
		["CLAUDE_SEATS_HANDOFF_FILE", handoffFile],
		["CLAUDE_SEATS_NAMES", "main dev dev2 dev3"],
	]);
	const calls: Calls = { ran: [], statuses: [], writes: [] };
	const api: SeatsApi = {
		clock: {
			after: (_delayMs: number, run: () => Promise<unknown>): unknown => run(),
		},
		command: {
			register: async (): Promise<unknown> => resolved({}),
			run: async (input: Readonly<{ command: string }>): Promise<unknown> => {
				calls.ran.push(input.command);
				await resolved(input);
				return {};
			},
		},
		env: {
			get: async (name: string): Promise<string | undefined> =>
				resolved(env[name]),
		},
		fs: {
			write: async (file: string, text: string): Promise<void> => {
				calls.writes.push([file, text]);
				await resolved(file);
			},
		},
		session: { id: async (): Promise<string> => resolved(sessionId) },
		ui: {
			status: (text?: string): void => {
				calls.statuses.push(text ?? "cleared");
			},
		},
	};
	return { api, calls };
};

await test("/seat dev3 writes the target seat and the session for cc, then quits Claude", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	const result = await handOff(api, " dev3 ");
	strictEqual(result.text, "Moving this session to dev3…");
	deepStrictEqual(calls.writes, [[handoffFile, `dev3\n${sessionId}\n`]]);
	deepStrictEqual(calls.ran, ["exit"]);
});

await test("/seat without a name asks cc for the best other seat", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	const result = await handOff(api, "");
	strictEqual(result.text, "Moving this session to the best other seat…");
	deepStrictEqual(calls.writes, [[handoffFile, `\n${sessionId}\n`]]);
	deepStrictEqual(calls.ran, ["exit"]);
});

await test("/seat refuses an unknown seat and the current seat; Claude keeps running", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	const unknown = await handOff(api, "dve3");
	strictEqual(
		unknown.text,
		'Unknown seat "dve3". Seats: main, dev, dev2, dev3.',
	);
	const same = await handOff(api, "dev");
	strictEqual(same.text, "This session already uses dev.");
	deepStrictEqual(calls.writes, []);
	deepStrictEqual(calls.ran, []);
});

await test("the status line warns at 90 % of a window and clears below it", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	await showLimits(api, [
		{ kind: "five_hour", percentUsed: 94 },
		{ kind: "seven_day", percentUsed: 89.9 },
	]);
	await showLimits(api, [{ kind: "five_hour", percentUsed: 12 }]);
	deepStrictEqual(calls.statuses, [
		"dev 5h 94 % · /seat moves this session to another seat",
		"cleared",
	]);
});

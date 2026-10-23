import {
	deepStrictEqual,
	notStrictEqual,
	strictEqual,
} from "node:assert/strict";
import { test } from "node:test";
import type { Elements, SeatsApi, UiNode } from "./api.ts";
import {
	drawBand,
	handOff,
	hideOnPrompt,
	openSeats,
	pick,
	showLimits,
} from "./register.ts";

const sessionId = "11111111-2222-4333-8444-555555555555";
const prompted = 1;
const unprompted = 0;
const handoffFile = "/tmp/cc-seat.test";
const entrypoint = "/repo/src/entrypoint.mjs";
const panelRows = JSON.stringify([
	{ alert: true, seat: "main", text: "main 5h 0% 7d 100%" },
	{ alert: false, seat: "dev3", text: "dev3 5h 7% 7d 2%" },
]);
interface UiCalls {
	readonly redraws: string[];
	readonly statuses: string[];
	readonly toasts: string[];
}
interface Calls extends UiCalls {
	readonly ran: string[];
	readonly runs: (readonly string[])[];
	readonly writes: (readonly [string, string])[];
}

const resolved = async <Value>(value: Value): Promise<Value> => {
	await Promise.resolve();
	return value;
};
// What the next hook returns when the band hook passes the band on.
const passed = Object.freeze({ passed: true });

const noElements: Elements = {
	Box: (): UiNode => ({}),
	Button: (): UiNode => ({}),
	Text: (): UiNode => ({}),
};

const fakeUi = (): Readonly<{ calls: UiCalls; ui: SeatsApi["ui"] }> => {
	const calls: UiCalls = {
		redraws: [],
		statuses: [],
		toasts: [],
	};
	const ui: SeatsApi["ui"] = {
		invalidate: (event: "ui.render"): void => {
			calls.redraws.push(event);
		},
		resolve: (): Elements => noElements,
		status: (text?: string): void => {
			calls.statuses.push(text ?? "cleared");
		},
		toast: (text: string): void => {
			calls.toasts.push(text);
		},
	};
	return { calls, ui };
};

// Cc answers with the menu rows; the picker reads only this output.
const fakeProcess = (): Readonly<{
	process: SeatsApi["process"];
	runs: (readonly string[])[];
}> => {
	const runs: (readonly string[])[] = [];
	const process: SeatsApi["process"] = {
		run: async (
			argv: readonly string[],
		): Promise<
			Readonly<{ exitCode: number; stderr: string; stdout: string }>
		> => {
			runs.push(argv);
			await resolved(argv);
			return { exitCode: 0, stderr: "", stdout: `display\0${panelRows}\0` };
		},
	};
	return { process, runs };
};

// A session that cc started on dev; it records what the mod asks Claude Code to do.
const fakeSession = (
	turns = prompted,
): Readonly<{ api: SeatsApi; calls: Calls }> => {
	const env: Readonly<Record<string, string>> = Object.fromEntries([
		["CLAUDE_SEATS_CURRENT", "dev"],
		["CLAUDE_SEATS_ENTRYPOINT", entrypoint],
		["CLAUDE_SEATS_HANDOFF_FILE", handoffFile],
		["CLAUDE_SEATS_NAMES", "main dev dev2 dev3"],
	]);
	const { calls: uiCalls, ui } = fakeUi();
	const { process, runs } = fakeProcess();
	const calls: Calls = { ...uiCalls, ran: [], runs, writes: [] };
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
		process,
		session: {
			id: async (): Promise<string> => resolved(sessionId),
			turns: async (): Promise<number> => resolved(turns),
		},
		ui,
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

await test("/seat before the first prompt asks cc for a new session on the target seat", async (): Promise<void> => {
	const { api, calls } = fakeSession(unprompted);
	await handOff(api, "dev3");
	deepStrictEqual(calls.writes, [[handoffFile, "dev3\nnew\n"]]);
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
		"dev 5h 94 % · /seats moves this session to another seat",
		"cleared",
	]);
});

// The band above the prompt as Claude Code raises it; true means a survey holds it.
const band = async (api: SeatsApi, hasSurvey = false): Promise<unknown> =>
	resolved(
		drawBand(
			api,
			{ props: { hasSurvey }, requestId: "above-prompt" },
			async (): Promise<unknown> => resolved(passed),
		),
	);

await test("/seats shows the picker above the prompt, after cc panel answers, unless a survey holds the band", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	strictEqual(await band(api), passed);
	deepStrictEqual(await openSeats(api), {});
	deepStrictEqual(calls.runs, [["node", entrypoint, "panel"]]);
	deepStrictEqual(calls.redraws, ["ui.render", "ui.render"]);
	notStrictEqual(await band(api), passed);
	strictEqual(await band(api, true), passed);
});

await test("a picked row hands the session off, hides the picker and says where it goes", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	await openSeats(api);
	await pick(api, "dev3");
	deepStrictEqual(calls.writes, [[handoffFile, `dev3\n${sessionId}\n`]]);
	deepStrictEqual(calls.toasts, ["Moving this session to dev3…"]);
	deepStrictEqual(calls.ran, ["exit"]);
	strictEqual(await band(api), passed);
});

await test("picking this session's own seat keeps the picker up and Claude running", async (): Promise<void> => {
	const { api, calls } = fakeSession();
	await openSeats(api);
	await pick(api, "dev");
	deepStrictEqual(calls.toasts, ["This session already uses dev."]);
	deepStrictEqual([calls.writes, calls.ran], [[], []]);
	notStrictEqual(await band(api), passed);
});

await test("the next prompt hides the picker and goes through", async (): Promise<void> => {
	const { api } = fakeSession();
	await openSeats(api);
	const prompt = { text: "2 things" };
	deepStrictEqual(
		await hideOnPrompt(
			api,
			prompt,
			async (event: unknown): Promise<unknown> => resolved(event),
		),
		prompt,
	);
	strictEqual(await band(api), passed);
});

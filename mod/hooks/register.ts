// Cc loads this mod through CLAUDE_CODE_PLUGIN_DIRS and sets the CLAUDE_SEATS_* variables for each launch.
import type { On, RateLimit, SeatsApi } from "./api.ts";
import type { View } from "./pane.ts";
import { panelView, paneTree } from "./pane.ts";

interface Seats {
	readonly current: string;
	readonly file: string;
	readonly names: readonly string[];
}
interface Move {
	readonly moved: boolean;
	readonly text: string;
}

const warnAt = 90;
const now = 0;
const nothing = 0;
// The seat rows plus a blank line and the key hint.
const paneChrome = 2;
const paneId = "seats";
const labels: ReadonlyMap<string, string> = new Map([
	["five_hour", "5h"],
	["seven_day", "7d"],
]);
// What the /seats pane shows; each /seats run reloads it.
let view: View = { kind: "loading" };

// The mod validator lists every variable a mod reads, so each name stays a literal.
const seatEnvironment = async ($: SeatsApi): Promise<Seats> => {
	const names = (await $.env.get("CLAUDE_SEATS_NAMES")) ?? "";
	return {
		current: (await $.env.get("CLAUDE_SEATS_CURRENT")) ?? "",
		file: (await $.env.get("CLAUDE_SEATS_HANDOFF_FILE")) ?? "",
		names: names.split(" "),
	};
};

const refusal = (seat: string, seats: Seats): string => {
	if (seat !== "" && !seats.names.includes(seat)) {
		return `Unknown seat "${seat}". Seats: ${seats.names.join(", ")}.`;
	}
	if (seat === seats.current) {
		return `This session already uses ${seat}.`;
	}
	return "";
};

const movingText = (seat: string): string => {
	if (seat === "") {
		return "Moving this session to the best other seat…";
	}
	return `Moving this session to ${seat}…`;
};

// Claude Code writes the transcript at the first prompt, so before it there is nothing to resume.
const resumable = async ($: SeatsApi): Promise<string> => {
	if ((await $.session.turns()) === nothing) {
		return "new";
	}
	return $.session.id();
};

// Cc reads the file after Claude quits and resumes the session on the target seat, or starts a new one there.
const move = async ($: SeatsApi, seat: string): Promise<Move> => {
	const seats = await seatEnvironment($);
	const refused = refusal(seat, seats);
	if (refused !== "") {
		return { moved: false, text: refused };
	}
	const session = await resumable($);
	await $.fs.write(seats.file, `${seat}\n${session}\n`);
	// Exit runs after this command, when the session is idle.
	$.clock.after(now, async () => $.command.run({ command: "exit" }));
	return { moved: true, text: movingText(seat) };
};

const handOff = async (
	$: SeatsApi,
	args: string,
): Promise<Readonly<{ text: string }>> => {
	const { text } = await move($, args.trim());
	return { text };
};

// A pressed row moves the session like /seat; a refused row leaves the pane open.
const pick = async ($: SeatsApi, seat: string): Promise<void> => {
	const result = await move($, seat);
	if (result.moved) {
		await $.ui.close({ id: paneId });
	}
	$.ui.toast(result.text);
};

const readPanel = async ($: SeatsApi, current: string): Promise<View> => {
	const entrypoint = (await $.env.get("CLAUDE_SEATS_ENTRYPOINT")) ?? "";
	try {
		return panelView(
			await $.process.run(["node", entrypoint, "panel"]),
			current,
		);
	} catch {
		return {
			kind: "error",
			reason: "Seat usage unavailable: cc panel failed.",
		};
	}
};

const openSeats = async ($: SeatsApi): Promise<Readonly<{ text?: string }>> => {
	const seats = await seatEnvironment($);
	view = { kind: "loading" };
	await $.ui.open({
		closeOnEscape: true,
		focus: true,
		id: paneId,
		rows: seats.names.length + paneChrome,
		title: "Seats",
	});
	view = await readPanel($, seats.current);
	$.ui.invalidate("ui.render");
	return {};
};

const showLimits = async (
	$: SeatsApi,
	rateLimits: readonly RateLimit[],
): Promise<void> => {
	const high = rateLimits
		.filter((limit) => limit.percentUsed >= warnAt)
		.map(
			(limit) =>
				`${labels.get(limit.kind) ?? limit.kind} ${String(limit.percentUsed)} %`,
		);
	if (high.length === nothing) {
		$.ui.status();
		return;
	}
	const { current } = await seatEnvironment($);
	$.ui.status(
		`${current} ${high.join(" · ")} · /seats moves this session to another seat`,
	);
};

const startedByCc = async ($: SeatsApi): Promise<boolean> =>
	typeof (await $.env.get("CLAUDE_SEATS_HANDOFF_FILE")) === "string";

const registerCommands = async ($: SeatsApi): Promise<void> => {
	await $.command.register({
		argumentHint: "[seat]",
		description: "Move this session to another seat, or to the best other seat",
		name: "seat",
	});
	await $.command.register({
		description: "Show every seat's usage; pick a row to move this session",
		immediate: true,
		name: "seats",
	});
};

const register = (on: On): void => {
	on("session.start", async ($, event, next) => {
		if (await startedByCc($)) {
			await registerCommands($);
		}
		return next(event);
	});
	on("command.run", { command: "seat" }, async ($, event) =>
		handOff($, event.args),
	);
	on("command.run", { command: "seats" }, async ($) => openSeats($));
	// The matcher limits this hook to the /seats pane; other panes never reach it.
	on("ui.render", { component: "Pane", requestId: paneId }, ($, event) =>
		paneTree($.ui.resolve(event), view, async (seat) => pick($, seat)),
	);
	on("session.measure", async ($, event, next) => {
		if (event.changed.includes("rateLimits") && (await startedByCc($))) {
			await showLimits($, event.rateLimits);
		}
		return next(event);
	});
};

export { handOff, openSeats, pick, register, showLimits };

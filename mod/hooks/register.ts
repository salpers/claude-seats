// Cc loads this mod through CLAUDE_CODE_PLUGIN_DIRS and sets the CLAUDE_SEATS_* variables for each launch.
import type { BandEvent, On, RateLimit, SeatsApi } from "./api.ts";
import type { View } from "./picker.ts";
import { panelView, pickerTree } from "./picker.ts";

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
const labels: ReadonlyMap<string, string> = new Map([
	["five_hour", "5h"],
	["seven_day", "7d"],
]);
// What /seats shows above the prompt; each /seats run reloads it.
let view: View = { kind: "loading" };
let shown = false;

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

const hide = ($: SeatsApi): void => {
	shown = false;
	$.ui.invalidate("ui.render");
};

// A pressed row moves the session like /seat; a refused row leaves the picker up.
const pick = async ($: SeatsApi, seat: string): Promise<void> => {
	const result = await move($, seat);
	if (result.moved) {
		hide($);
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
	shown = true;
	$.ui.invalidate("ui.render");
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

// A pane docks beside a wide fullscreen transcript; the band above the prompt stays at the bottom.
const drawBand = (
	$: SeatsApi,
	event: BandEvent,
	next: (event: BandEvent) => Promise<unknown>,
): unknown => {
	if (!shown || event.props.hasSurvey) {
		return next(event);
	}
	return pickerTree($.ui.resolve(event), view, {
		close: () => {
			hide($);
		},
		pick: async (seat: string): Promise<void> => pick($, seat),
	});
};

// The picker's digits would catch the start of the next prompt, so a prompt hides it.
const hideOnPrompt = (
	$: SeatsApi,
	event: unknown,
	next: (event: unknown) => Promise<unknown>,
): unknown => {
	if (shown) {
		hide($);
	}
	return next(event);
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
	on("ui.render", { component: "AbovePrompt" }, ($, event, next) =>
		drawBand($, event, next),
	);
	on("prompt.submit", ($, event, next) => hideOnPrompt($, event, next));
	on("session.measure", async ($, event, next) => {
		if (event.changed.includes("rateLimits") && (await startedByCc($))) {
			await showLimits($, event.rateLimits);
		}
		return next(event);
	});
};

export {
	drawBand,
	handOff,
	hideOnPrompt,
	openSeats,
	pick,
	register,
	showLimits,
};

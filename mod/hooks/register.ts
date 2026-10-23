// Cc loads this mod through CLAUDE_CODE_PLUGIN_DIRS and sets the CLAUDE_SEATS_* variables for each launch.

// The part of the mods API this mod uses; each Claude Code build ships the full types.
interface SeatsApi {
	readonly clock: {
		readonly after: (delayMs: number, run: () => Promise<unknown>) => unknown;
	};
	readonly command: {
		readonly register: (
			command: Readonly<{
				argumentHint: string;
				description: string;
				name: string;
			}>,
		) => Promise<unknown>;
		readonly run: (input: Readonly<{ command: string }>) => Promise<unknown>;
	};
	readonly env: {
		readonly get: (name: string) => Promise<string | undefined>;
	};
	readonly fs: {
		readonly write: (file: string, text: string) => Promise<void>;
	};
	readonly session: { readonly id: () => Promise<string> };
	// No text removes this mod's status line.
	readonly ui: { readonly status: (text?: string) => void };
}
interface RateLimit {
	readonly kind: string;
	readonly percentUsed: number;
}
interface Measure {
	readonly changed: readonly string[];
	readonly rateLimits: readonly RateLimit[];
}
type Next<Event> = (event: Event) => Promise<unknown>;
interface On {
	(
		name: "session.start",
		hook: (
			$: SeatsApi,
			event: unknown,
			next: Next<unknown>,
		) => Promise<unknown>,
	): void;
	(
		name: "command.run",
		matcher: Readonly<{ command: string }>,
		hook: (
			$: SeatsApi,
			event: Readonly<{ args: string }>,
		) => Promise<Readonly<{ text: string }>>,
	): void;
	(
		name: "session.measure",
		hook: (
			$: SeatsApi,
			event: Measure,
			next: Next<Measure>,
		) => Promise<unknown>,
	): void;
}
interface Seats {
	readonly current: string;
	readonly file: string;
	readonly names: readonly string[];
}

const warnAt = 90;
const now = 0;
const nothing = 0;
const labels: ReadonlyMap<string, string> = new Map([
	["five_hour", "5h"],
	["seven_day", "7d"],
]);

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

// Cc reads the file after Claude quits and resumes the session on the target seat.
const writeHandOff = async (
	$: SeatsApi,
	file: string,
	seat: string,
): Promise<void> => {
	const session = await $.session.id();
	await $.fs.write(file, `${seat}\n${session}\n`);
	// Exit runs after this command, when the session is idle.
	$.clock.after(now, async () => $.command.run({ command: "exit" }));
};

const handOff = async (
	$: SeatsApi,
	args: string,
): Promise<Readonly<{ text: string }>> => {
	const seat = args.trim();
	const seats = await seatEnvironment($);
	const refused = refusal(seat, seats);
	if (refused !== "") {
		return { text: refused };
	}
	await writeHandOff($, seats.file, seat);
	if (seat === "") {
		return { text: "Moving this session to the best other seat…" };
	}
	return { text: `Moving this session to ${seat}…` };
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
		`${current} ${high.join(" · ")} · /seat moves this session to another seat`,
	);
};

const startedByCc = async ($: SeatsApi): Promise<boolean> =>
	typeof (await $.env.get("CLAUDE_SEATS_HANDOFF_FILE")) === "string";

const register = (on: On): void => {
	on("session.start", async ($, event, next) => {
		if (await startedByCc($)) {
			await $.command.register({
				argumentHint: "[seat]",
				description:
					"Move this session to another seat, or to the best other seat",
				name: "seat",
			});
		}
		return next(event);
	});
	on("command.run", { command: "seat" }, async ($, event) =>
		handOff($, event.args),
	);
	on("session.measure", async ($, event, next) => {
		if (event.changed.includes("rateLimits") && (await startedByCc($))) {
			await showLimits($, event.rateLimits);
		}
		return next(event);
	});
};

export type { SeatsApi };
export { handOff, register, showLimits };

import type { SeatName } from "./seats.ts";

const noSelector = 0;
const selectorLength = 1;

type ParsedArgs =
	| { readonly kind: "list"; readonly ok: true }
	| { readonly kind: "doctor"; readonly ok: true }
	| { readonly kind: "install"; readonly ok: true }
	| { readonly kind: "menu"; readonly ok: true }
	| {
			readonly kind: "auto";
			readonly ok: true;
			readonly consumed: typeof noSelector;
	  }
	| {
			readonly consumed: typeof selectorLength;
			readonly kind: "launch";
			readonly ok: true;
			readonly seat: SeatName;
	  }
	| { readonly ok: false; readonly reason: string };

const usage = (names: readonly SeatName[]): ParsedArgs => ({
	ok: false,
	reason: `Use @ to list seats, or ${names.map((name) => `@${name}`).join(", ")} to launch.`,
});

const parseSelector = (
	selector: string,
	names: readonly SeatName[],
): ParsedArgs => {
	const seat = selector.slice(selectorLength);
	if (names.includes(seat)) {
		return { consumed: selectorLength, kind: "launch", ok: true, seat };
	}
	return usage(names);
};

const parseCommand = (
	kind: "doctor" | "install" | "menu",
	length: number,
): ParsedArgs => {
	if (length === selectorLength) {
		return { kind, ok: true };
	}
	return { ok: false, reason: `Use cc ${kind} without additional arguments.` };
};

const parseArgs = (
	args: readonly string[],
	names: readonly SeatName[],
): ParsedArgs => {
	const [first] = args;
	if (first === "doctor" || first === "install" || first === "menu") {
		return parseCommand(first, args.length);
	}
	if (first === "@") {
		if (args.length === selectorLength) {
			return { kind: "list", ok: true };
		}
		return usage(names);
	}
	if (typeof first === "string" && first.startsWith("@")) {
		return parseSelector(first, names);
	}
	return { consumed: noSelector, kind: "auto", ok: true };
};

export type { ParsedArgs };
export { parseArgs };

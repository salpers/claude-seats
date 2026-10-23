import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

await test("doctor and install are standalone router commands; escaped or seat-specific words pass through", (): void => {
	for (const kind of ["doctor", "install"]) {
		deepStrictEqual(parseArgs([kind]), { kind, ok: true });
		deepStrictEqual(parseArgs([kind, "private argument"]), {
			ok: false,
			reason: `Use cc ${kind} without additional arguments.`,
		});
		deepStrictEqual(parseArgs(["--", kind]), {
			consumed: 0,
			kind: "auto",
			ok: true,
		});
		deepStrictEqual(parseArgs(["@dev", kind]), {
			consumed: 1,
			kind: "launch",
			ok: true,
			seat: "dev",
		});
	}
});

await test("a leading selector chooses a seat and consumes only that argument", (): void => {
	for (const seat of ["main", "dev", "dev2", "dev3"]) {
		deepStrictEqual(parseArgs([`@${seat}`, "--resume", "abc"]), {
			consumed: 1,
			kind: "launch",
			ok: true,
			seat,
		});
	}
});

await test("bare @ lists seats, and unknown selectors fail without reflecting input", (): void => {
	deepStrictEqual(parseArgs(["@"]), { kind: "list", ok: true });
	for (const args of [["@unknown"], ["@api"], ["@", "extra"]]) {
		deepStrictEqual(parseArgs(args), {
			ok: false,
			reason: "Use @ to list seats, or @main, @dev, @dev2, @dev3 to launch.",
		});
	}
});

await test("passthrough and -- handling never interpret later Claude arguments", (): void => {
	for (const args of [
		[],
		["--resume", "abc"],
		["--", "@dev2"],
		["prompt", "@unknown"],
	]) {
		const original = [...args];
		deepStrictEqual(parseArgs(args), {
			consumed: 0,
			kind: "auto",
			ok: true,
		});
		deepStrictEqual(args, original);
	}
	deepStrictEqual(parseArgs(["@dev2", "--", "@unknown", ""]), {
		consumed: 1,
		kind: "launch",
		ok: true,
		seat: "dev2",
	});
});

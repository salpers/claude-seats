import { runBoundedCommand } from "./bounded-command.mjs";

const timeout = 1000;
const maxBuffer = 65_536;
const success = 0;

/** @param {string} command @param {string} input */
const runLegacy = async (command, input) => {
	const result = await runBoundedCommand("/bin/sh", ["-c", command], {
		input,
		maxBuffer,
		timeout,
	});
	if (result.status !== success) {
		return "";
	}
	const { statuslinePrefix } = await import("./statusline-prefix.ts");
	return statuslinePrefix(result.stdout);
};

/** @param {string} command @param {string} input */
const readStatuslinePrefix = async (command, input) => {
	try {
		return await runLegacy(command, input);
	} catch {
		return "";
	}
};

export { readStatuslinePrefix };

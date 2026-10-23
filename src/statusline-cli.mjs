import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { readStatuslinePrefix } from "./statusline-command.mjs";

const failure = 1;
process.stdout.on(
	"error",
	/** @param {Readonly<NodeJS.ErrnoException>} error */
	(error) => {
		// A disappearing statusline reader is normal; other output failures remain quiet.
		if (error.code !== "EPIPE") {
			process.exitCode = failure;
		}
	},
);

const argumentOffset = 2;
const [option, command] = process.argv.slice(argumentOffset);
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	input += String(chunk);
}
let prefix = Promise.resolve("");
if (option === "--legacy-command" && typeof command === "string") {
	prefix = readStatuslinePrefix(command, input);
	// Flush stdin/EOF so shell capture can start Python before synchronous TS stripping.
	await setImmediate();
}
// Compile the usage modules while the legacy Python process starts.
const { renderStatuslineSegment } = await import("./statusline-segment.ts");
const [before, segment] = await Promise.all([
	prefix,
	renderStatuslineSegment(input, process.env),
]);
process.stdout.write(`${before}${segment}\n`);

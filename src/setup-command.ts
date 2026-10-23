import process from "node:process";
import type { SetupOptions, SetupReport } from "./doctor.ts";
import { doctor } from "./doctor.ts";
import { install } from "./install.ts";
import { stateDirectory } from "./list-seats.ts";
import { printError, printReply } from "./output.ts";
import type { SeatEnvironment } from "./route-seats.ts";
import { loadSeats } from "./seats.ts";

const unavailable = 1;
const setupReport = async (
	command: "doctor" | "install",
	options: SetupOptions,
): Promise<SetupReport> => {
	const registry = await loadSeats(options.home);
	if (!registry.ok) {
		return { messages: [registry.reason], ok: false };
	}
	const names = registry.seats.map((seat) => seat.name);
	if (command === "install") {
		return install({ ...options, names });
	}
	const report = await doctor({ ...options, names });
	if (report.ok) {
		return {
			messages: [
				`Setup is healthy: Node >=24, seats ${names.join(", ")}, shared links, credential presence, private state and statusLine.`,
			],
			ok: true,
		};
	}
	return report;
};

const setupCommand = async (
	command: "doctor" | "install",
	options: SeatEnvironment,
): Promise<void> => {
	const report = await setupReport(command, {
		env: options.env,
		fixtureDirectory: options.env["CLAUDE_SEATS_KEYCHAIN_DIR"],
		home: options.home,
		state: stateDirectory(options.env, options.home),
	});
	if (report.ok) {
		printReply(["display", report.messages.join("\n")]);
	} else {
		printError(report.messages.join("\n"));
		process.exitCode = unavailable;
	}
};

export { setupCommand };

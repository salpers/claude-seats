import process from "node:process";
import type { SetupOptions, SetupReport } from "./doctor.ts";
import { doctor } from "./doctor.ts";
import { install } from "./install.ts";
import { stateDirectory } from "./list-seats.ts";
import { printError, printReply } from "./output.ts";
import type { SeatEnvironment } from "./route-seats.ts";

const unavailable = 1;
const setupReport = async (
	command: "doctor" | "install",
	options: SetupOptions,
): Promise<SetupReport> => {
	if (command === "install") {
		return install(options);
	}
	const report = await doctor(options);
	if (report.ok) {
		return {
			messages: [
				"Setup is healthy: Node >=24, four seats, shared links, credential presence, private state and statusLine.",
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

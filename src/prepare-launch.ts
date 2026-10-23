import process from "node:process";
import { ensureLaunchSettings } from "./launch-settings.ts";
import { printError } from "./output.ts";
import type { Seat } from "./seats.ts";
import { syncProjects } from "./sync-projects.ts";

const unavailable = 1;
const prepareLaunch = async (
	seats: readonly Seat[],
	home: string,
): Promise<boolean> => {
	const settings = await ensureLaunchSettings(home);
	if (!settings.ok) {
		printError(settings.reason);
		process.exitCode = unavailable;
		return false;
	}
	for (const failure of await syncProjects(seats)) {
		printError(`Project sync skipped ${failure.seat}: ${failure.reason}.`);
	}
	return true;
};

export { prepareLaunch };

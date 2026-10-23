import path from "node:path";
import { checkCredential } from "./credentials.ts";
import { formatMenu, formatPanel } from "./menubar.ts";
import { readCredential } from "./oauth.ts";
import type { SeatRow } from "./output.ts";
import { formatSeats, printError, printReply } from "./output.ts";
import type { Seat } from "./seats.ts";
import { countLiveSessions } from "./sessions.ts";
import { createUsageCache } from "./usage-cache.ts";
import { fetchUsage } from "./usage-client.ts";
import { probeSeatUsage } from "./usage-probe.ts";

const stateDirectory = (
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string =>
	env["CLAUDE_SEATS_STATE_DIR"] ?? path.join(home, ".claude-shared", "_seats");

const readSeatRows = async (
	seats: readonly Seat[],
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): Promise<readonly SeatRow[]> => {
	const fixtureDirectory = env["CLAUDE_SEATS_KEYCHAIN_DIR"];
	const cache = createUsageCache(stateDirectory(env, home));
	const rows = await Promise.all(
		seats.map(async (seat): Promise<SeatRow> => {
			const credential = await checkCredential(seat.slot, { fixtureDirectory });
			const usage = await probeSeatUsage(seat.name, credential, {
				cache,
				readCredential: async () =>
					readCredential(seat.slot, { fixtureDirectory }),
				request: async (accessToken: string) =>
					fetchUsage(accessToken, { baseUrl: env["CLAUDE_SEATS_USAGE_URL"] }),
			});
			const live = await countLiveSessions(seat.directory);
			return { credential, live, seat, usage };
		}),
	);
	return rows;
};

const listSeats = async (
	seats: readonly Seat[],
	{
		env,
		home,
	}: Readonly<{
		env: Readonly<Record<string, string | undefined>>;
		home: string;
	}>,
	kind: "list" | "menu" | "panel",
): Promise<void> => {
	const rows = await readSeatRows(seats, env, home);
	// The /seats pane in Claude Code reads this JSON; it shows the menu bar's rows.
	if (kind === "panel") {
		printReply(["display", formatPanel(rows)]);
		return;
	}
	// The menu bar has nowhere to show a stderr notice, so it renders rows only.
	if (kind === "menu") {
		printReply(["display", formatMenu(rows)]);
		return;
	}
	printReply(["display", formatSeats(rows)]);
	if (rows.some((row) => !row.credential.ok)) {
		printError("Credential presence unavailable for rows marked unknown.");
	}
};

export { listSeats, readSeatRows, stateDirectory };

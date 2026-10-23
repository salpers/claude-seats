import path from "node:path";
import { authEnvironmentProblems } from "./claude-environment.ts";
import type { CredentialPresence } from "./credentials.ts";
import { checkCredential } from "./credentials.ts";
import { failFastSettings } from "./handoff-settings.ts";
import type { ConfigRead } from "./project-config-file.ts";
import { readProjectFile } from "./project-config-file.ts";
import type { Seat, SeatName } from "./seats.ts";
import { createSeats } from "./seats.ts";
import type { EntryState } from "./setup-files.ts";
import { inspectEntry, privateStateDirectory } from "./setup-files.ts";
import type { LayoutEntry } from "./setup-layout.ts";
import { layoutProblem, setupLayout } from "./setup-layout.ts";
import {
	installedStatuslineCommand,
	statuslineCommand,
} from "./statusline-runtime.ts";
import { statuslineSettings } from "./statusline-settings.ts";

interface SetupOptions {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly home: string;
	readonly state: string;
	readonly fixtureDirectory?: string | undefined;
	readonly names?: readonly SeatName[];
}
interface DoctorIo {
	readonly inspect: (entry: LayoutEntry) => EntryState | Promise<EntryState>;
	readonly credential: (
		seat: Seat,
	) => CredentialPresence | Promise<CredentialPresence>;
	readonly privateState: (directory: string) => boolean | Promise<boolean>;
	readonly settings: (file: string) => ConfigRead | Promise<ConfigRead>;
	readonly statuslineCommand: (text: string) => string | Promise<string>;
}
interface SetupReport {
	readonly ok: boolean;
	readonly messages: readonly string[];
}
const zero = 0;
const settingsWiringProblems = (
	text: string,
	statusline: string,
	handoff: string,
): readonly string[] => {
	const messages: string[] = [];
	if (statusline !== text) {
		messages.push(
			"Hub statusLine is missing, invalid, or not wired to this checkout and Node; run cc install.",
		);
	}
	if (handoff !== text) {
		messages.push(
			"Hub autoContinueAtUsageLimit must be false; run cc install.",
		);
	}
	return messages;
};
const settingsTextProblems = (
	text: string,
	command?: string,
): readonly string[] => {
	const statusline = statuslineSettings(text, command);
	const handoff = failFastSettings(text);
	if (!handoff.ok) {
		return [
			"Hub .claude/settings.json must contain a valid JSON object with no duplicate top-level keys; fix its contents before running cc install to wire statusLine and autoContinueAtUsageLimit.",
		];
	}
	if (!statusline.ok) {
		return [
			"Cannot safely configure hub .claude/settings.json; repair or remove the statusLine field before running cc install to wire statusLine and autoContinueAtUsageLimit.",
		];
	}
	return settingsWiringProblems(text, statusline.text, handoff.text);
};
const settingsProblems = (
	current: ConfigRead,
	command?: string,
): readonly string[] => {
	if (!current.ok) {
		return [
			"Cannot safely read hub .claude/settings.json; restore a readable, writable regular UTF-8 file (not a symlink), then run cc install to wire statusLine and autoContinueAtUsageLimit.",
		];
	}
	if (!current.exists) {
		return [
			"Cannot read hub .claude/settings.json; run cc install to wire statusLine and fail-fast settings.",
		];
	}
	return settingsTextProblems(current.text, command);
};

const credentialProblem = async (
	seat: Seat,
	io: DoctorIo,
): Promise<readonly string[]> => {
	const credential = await io.credential(seat);
	if (!credential.ok) {
		return [
			`${seat.name}: keychain slot presence unavailable; check credential-store access.`,
		];
	}
	if (!credential.present) {
		return [
			`${seat.name}: keychain slot missing (${seat.slot}); log in with cc @${seat.name} auth login.`,
		];
	}
	return [];
};

const doctorIo = (options: SetupOptions): DoctorIo => ({
	credential: async (seat: Seat): Promise<CredentialPresence> =>
		checkCredential(seat.slot, {
			fixtureDirectory: options.fixtureDirectory,
		}),
	inspect: inspectEntry,
	privateState: privateStateDirectory,
	settings: readProjectFile,
	statuslineCommand: installedStatuslineCommand,
});

const layoutProblems = async (
	options: SetupOptions,
	io: DoctorIo,
): Promise<readonly string[]> => {
	const results = await Promise.all(
		setupLayout(options.home, options.state, options.names).map(
			async (entry): Promise<readonly string[]> => {
				if ((await io.inspect(entry)) !== "ready") {
					return [layoutProblem(entry)];
				}
				return [];
			},
		),
	);
	return results.flat();
};

const doctor = async (
	options: SetupOptions,
	io: DoctorIo = doctorIo(options),
): Promise<SetupReport> => {
	const credentials = await Promise.all(
		createSeats(options.home, options.names).map(async (seat) =>
			credentialProblem(seat, io),
		),
	);
	const messages = [
		...authEnvironmentProblems(options.env ?? {}),
		...(await layoutProblems(options, io)),
		...credentials.flat(),
	];
	if (!(await io.privateState(options.state))) {
		messages.push(
			`The state directory must be readable, writable, searchable and private (mode 0700): ${JSON.stringify(options.state)}.`,
		);
	}
	const settings = await io.settings(
		path.join(options.home, ".claude/settings.json"),
	);
	let command = statuslineCommand;
	if (settings.ok) {
		command = await io.statuslineCommand(settings.text);
	}
	messages.push(...settingsProblems(settings, command));
	return { messages, ok: messages.length === zero };
};

export type { DoctorIo, SetupOptions, SetupReport };
export { doctor, settingsProblems };

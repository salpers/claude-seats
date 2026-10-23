import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isRecord, parseJson } from "./json.ts";
import { parseWrapper, shellQuote } from "./statusline-wrapper.ts";

const entrypoint = path.join(import.meta.dirname, "statusline-cli.mjs");
const statuslineCommand = `${shellQuote(process.execPath)} ${shellQuote(entrypoint)}`;

const executableFile = async (file: string): Promise<boolean> => {
	try {
		const info = await stat(file);
		await access(file, constants.X_OK);
		return info.isFile();
	} catch {
		return false;
	}
};

const savedCommand = (text: string): string => {
	const parsed = parseJson(text);
	if (
		!(
			parsed.ok &&
			isRecord(parsed.value) &&
			isRecord(parsed.value["statusLine"])
		)
	) {
		return "";
	}
	const { command } = parsed.value["statusLine"];
	if (typeof command === "string") {
		return command;
	}
	return "";
};

const installedStatuslineCommand = async (
	text: string,
	runtime: "installed" | "current" = "installed",
	isExecutable: (file: string) => boolean | Promise<boolean> = executableFile,
): Promise<string> => {
	if (runtime === "current") {
		return statuslineCommand;
	}
	const wrapper = parseWrapper(savedCommand(text));
	// Retain the installed runtime across cwd-dependent Node selection, without executing it in doctor.
	if (
		wrapper.ok &&
		wrapper.entrypoint === entrypoint &&
		(await isExecutable(wrapper.node))
	) {
		return `${shellQuote(wrapper.node)} ${shellQuote(entrypoint)}`;
	}
	return statuslineCommand;
};

export { installedStatuslineCommand, statuslineCommand };

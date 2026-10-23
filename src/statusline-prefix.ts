import { stripVTControlCharacters } from "node:util";

const zero = 0;
const last = -1;
const minimumPrefixFields = 3;
const separator = " | ";
const email = /^[^\s@]+@[^\s@]+$/u;
const sessionLabel = /^sess\s/u;
const weeklyLabel = /^wk\s/u;
const contextLabel = /^ctx\s/u;
const trailingNewlines = /(?:\r?\n)+$/u;

const hasContextBoundary = (fields: readonly string[]): boolean =>
	fields.length >= minimumPrefixFields &&
	contextLabel.test(stripVTControlCharacters(fields.at(last) ?? ""));

const dropEmail = (fields: readonly string[]): readonly string[] => {
	if (email.test(stripVTControlCharacters(fields.at(last) ?? ""))) {
		return fields.slice(zero, last);
	}
	return fields;
};
const prefixFields = (fields: readonly string[]): readonly string[] => {
	let prefix = fields;
	// Claude supplies each window independently, so either tail field may be absent.
	for (const label of [weeklyLabel, sessionLabel]) {
		if (label.test(stripVTControlCharacters(prefix.at(last) ?? ""))) {
			prefix = prefix.slice(zero, last);
		}
	}
	return prefix;
};
const statuslinePrefix = (output: string): string => {
	const line = output.replace(trailingNewlines, "");
	if (line === "") {
		return "";
	}
	const parts = line.split(separator);
	// The legacy identity may be a display name; require context before dropping an arbitrary tail.
	let fields = prefixFields(parts.slice(zero, last));
	if (!hasContextBoundary(fields)) {
		fields = prefixFields(dropEmail(parts));
	}
	if (fields.length === zero) {
		return "";
	}
	// Splitting and rejoining the literal separator preserves color and prefix bytes.
	return `${fields.join(separator)}${separator}`;
};

export { statuslinePrefix };

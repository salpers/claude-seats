import path from "node:path";

type Wrapper =
	| {
			readonly ok: true;
			readonly legacy: string | false;
			readonly node: string;
			readonly entrypoint: string;
	  }
	| { readonly ok: false };
const start = 0;
const shellQuote = (text: string): string =>
	`'${text.replaceAll("'", String.raw`'\''`)}'`;
const wrapperPattern =
	/^'(?<node>(?:[^']|'\\'')*)' '(?<entrypoint>(?:[^']|'\\'')*)'(?: --legacy-command '(?<legacy>(?:[^']|'\\'')*)')?$/u;
const unquote = (text: string): string =>
	text.replaceAll(String.raw`'\''`, "'");

const isWrapperPaths = (node: unknown, entrypoint: unknown): boolean => {
	if (typeof node !== "string" || typeof entrypoint !== "string") {
		return false;
	}
	const nodePath = unquote(node);
	const entrypointPath = unquote(entrypoint);
	return (
		path.isAbsolute(nodePath) &&
		path.basename(nodePath) === "node" &&
		path.isAbsolute(entrypointPath) &&
		["statusline-cli.ts", "statusline-cli.mjs"].includes(
			path.basename(entrypointPath),
		) &&
		path.basename(path.dirname(entrypointPath)) === "src"
	);
};

const wrapperFromGroups = (
	groups: Readonly<Record<string, string>>,
): Wrapper => {
	const { node, entrypoint, legacy } = groups;
	if (
		typeof node !== "string" ||
		typeof entrypoint !== "string" ||
		!isWrapperPaths(node, entrypoint)
	) {
		return { ok: false };
	}
	if (typeof legacy === "string") {
		return {
			entrypoint: unquote(entrypoint),
			legacy: unquote(legacy),
			node: unquote(node),
			ok: true,
		};
	}
	return {
		entrypoint: unquote(entrypoint),
		legacy: false,
		node: unquote(node),
		ok: true,
	};
};

const parseWrapper = (command: string): Wrapper => {
	const match = wrapperPattern.exec(command);
	if (match === null) {
		return { ok: false };
	}
	const { groups } = match;
	if (!groups || match[start] !== command) {
		return { ok: false };
	}
	return wrapperFromGroups(groups);
};

const originalCommand = (command: string): string | false => {
	let current = command;
	let wrapper = parseWrapper(current);
	// Old Node/checkouts may no longer exist; recover the prefix command without executing them.
	while (wrapper.ok) {
		if (wrapper.legacy === false) {
			return false;
		}
		current = wrapper.legacy;
		wrapper = parseWrapper(current);
	}
	return current;
};

const rewrapStatuslineCommand = (legacy: string, command: string): string => {
	const original = originalCommand(legacy);
	if (original === false) {
		return command;
	}
	return `${command} --legacy-command ${shellQuote(original)}`;
};

export { parseWrapper, rewrapStatuslineCommand, shellQuote };

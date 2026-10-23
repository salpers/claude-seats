type Environment = Readonly<Record<string, string | undefined>>;
const zero = 0;

const providerKeys = new Set([
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"CLAUDE_CODE_USE_FOUNDRY",
]);
const overridesSeatAuth = (key: string): boolean =>
	key.startsWith("ANTHROPIC_") ||
	key.startsWith("CLAUDE_CODE_OAUTH_TOKEN") ||
	providerKeys.has(key);

const authEnvironmentProblems = (env: Environment): readonly string[] => {
	const keys = Object.keys(env)
		.filter(
			(key) =>
				overridesSeatAuth(key) &&
				typeof env[key] === "string" &&
				env[key] !== "",
		)
		.toSorted();
	if (keys.length === zero) {
		return [];
	}
	return [
		`Auth/provider environment overrides (${keys.join(", ")}) can make the launched session use a different account or provider than the selected seat. Unset them before cc; fallback probes ignore them.`,
	];
};

export { authEnvironmentProblems, overridesSeatAuth };

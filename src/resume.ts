interface ResumeMetadata {
	readonly resume?: true;
	readonly sessionId?: string;
}

const sessionIdPattern =
	/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
const sessionIdLength = 36;

const parseResume = (args: readonly string[]): ResumeMetadata => {
	const [flag, sessionId] = args;
	if (flag !== "-r" && flag !== "--resume") {
		return {};
	}
	// Arbitrary argument text can contain private data; only UUIDs enter the audit.
	if (
		typeof sessionId === "string" &&
		sessionId.length === sessionIdLength &&
		sessionIdPattern.test(sessionId)
	) {
		return { resume: true, sessionId };
	}
	return { resume: true };
};

export type { ResumeMetadata };
export { parseResume };

type JsonResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false };

const parseJson = (text: string): JsonResult => {
	try {
		const value: unknown = JSON.parse(text);
		return { ok: true, value };
	} catch {
		return { ok: false };
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export { isRecord, parseJson };

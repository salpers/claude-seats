import { ensureHandoffSettings } from "./handoff-settings.ts";
import { ensureStatuslineSettings } from "./statusline-settings.ts";

const ensureLaunchSettings = async (
	home: string,
	runtime: "installed" | "current" = "installed",
): Promise<
	{ readonly ok: true } | { readonly ok: false; readonly reason: string }
> => {
	const handoff = await ensureHandoffSettings(home);
	if (!handoff.ok) {
		return handoff;
	}
	if (!(await ensureStatuslineSettings(home, runtime))) {
		return {
			ok: false,
			reason: "Cannot configure statusLine in shared .claude/settings.json.",
		};
	}
	return { ok: true };
};

export { ensureLaunchSettings };

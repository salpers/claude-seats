import process from "node:process";

const minimumMajor = 24;
const failure = 1;
const [major] = process.versions.node.split(".");

// This must remain JavaScript so older Node versions can diagnose missing TS support.
if (Number(major) >= minimumMajor) {
	await import("./cli.ts");
} else {
	process.stderr.write(
		`cc: Node >=24 is required (found ${process.versions.node}); put Node 24 or newer on PATH and retry cc.\n`,
	);
	process.exitCode = failure;
}

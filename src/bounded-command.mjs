import { spawn } from "node:child_process";
import process from "node:process";

/** @typedef {Readonly<Pick<import("node:stream").Readable, "setEncoding" | "on" | "destroy">>} ReadableStream */
/** @typedef {Readonly<Pick<import("node:child_process").ChildProcessWithoutNullStreams, "pid" | "kill" | "unref" | "on">> & {readonly stdin: Readonly<Pick<import("node:stream").Writable, "end" | "on" | "destroy">>, readonly stdout: ReadableStream, readonly stderr: ReadableStream}} RunningCommand */
/** @typedef {{readonly env?: Readonly<Record<string, string | undefined>> | undefined, readonly input?: string, readonly timeout: number, readonly maxBuffer: number}} CommandOptions */
/** @typedef {{readonly status: number | "unavailable", readonly stdout: string, readonly stderr: string}} CommandReply */
/** @type {CommandReply} */
const unavailable = {
	status: "unavailable",
	stderr: "",
	stdout: "",
};

/** @param {RunningCommand} child */
const dispose = (child) => {
	if (typeof child.pid === "number") {
		try {
			// Detached POSIX children lead a group containing their shell pipelines and workers.
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// The group may already have exited or be unavailable on this platform.
			child.kill("SIGKILL");
		}
	}
	child.stdin.destroy();
	child.stdout.destroy();
	child.stderr.destroy();
	child.unref();
};

/**
 * @param {ReadableStream} stream
 * @param {number} maxBuffer
 * @param {() => void} abort
 */
const capture = (stream, maxBuffer, abort) => {
	let text = "";
	stream.setEncoding("utf8").on(
		"data",
		/** @param {string} chunk */
		(chunk) => {
			if (Buffer.byteLength(text) + Buffer.byteLength(chunk) > maxBuffer) {
				abort();
				return;
			}
			text += chunk;
		},
	);
	return () => text;
};

/**
 * @param {RunningCommand} child
 * @param {number} maxBuffer
 * @param {(reply: CommandReply) => void} resolve
 */
const collect = (child, maxBuffer, resolve) => {
	const abort = () => {
		resolve(unavailable);
	};
	const stdout = capture(child.stdout, maxBuffer, abort);
	const stderr = capture(child.stderr, maxBuffer, abort);
	child.on("error", abort);
	child.on("close", (code) => {
		if (code === null) {
			abort();
			return;
		}
		resolve({ status: code, stderr: stderr(), stdout: stdout() });
	});
	child.stdin.on("error", () => {
		// Commands may close stdin early; their exit result still decides success.
	});
};

/**
 * JavaScript lets the statusline start its child before loading the TS stripper.
 * @param {string} binary
 * @param {readonly string[]} args
 * @param {CommandOptions} options
 * @returns {Promise<CommandReply>}
 */
const runBoundedCommand = async (
	binary,
	args,
	{ env, input, timeout, maxBuffer },
) => {
	const child = spawn(binary, args, { detached: true, env, stdio: "pipe" });
	/** @type {PromiseWithResolvers<CommandReply>} */
	const completion = Promise.withResolvers();
	// Keep the deadline alive until the pipes close, even if the direct child exits first.
	const timer = setTimeout(() => {
		completion.resolve(unavailable);
	}, timeout);
	collect(child, maxBuffer, completion.resolve);
	child.stdin.end(input);
	try {
		return await completion.promise;
	} finally {
		clearTimeout(timer);
		dispose(child);
	}
};

export { runBoundedCommand };

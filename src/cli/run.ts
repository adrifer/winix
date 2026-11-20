import { spawn } from "node:child_process";

/**
 * Run a command to completion without blocking the event loop (so progress
 * output keeps updating), resolving stdout. Errors carry stderr.
 */
export function captureCommand(
  command: string, args: string[], opts: { input?: string; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeout
      ? setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, opts.timeout)
      : undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(opts.input ?? "");
  });
}

export async function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; dry?: boolean } = {}
): Promise<void> {
  const printable = [command, ...args].join(" ");
  if (opts.dry) {
    console.log(printable);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(new Error(`${command} exited from signal ${signal}`));
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

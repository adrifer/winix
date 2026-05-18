import { spawn } from "node:child_process";

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

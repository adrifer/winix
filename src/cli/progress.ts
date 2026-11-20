// Progress feedback for long CLI phases: a one-line spinner with elapsed time
// while work runs (interactive terminals only), then one permanent line per
// finished phase. Non-interactive output gets the permanent lines only.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 100;

interface Active {
  text: string;
  started: number;
}

let active: Active | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let frame = 0;

function interactive(): boolean {
  return process.stderr.isTTY === true && !process.env.CI;
}

/** Whether the spinner is shown (an interactive terminal). */
export function isInteractive(): boolean {
  return interactive();
}

export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function render(): void {
  if (!active || !interactive()) return;
  const elapsed = Date.now() - active.started;
  const width = process.stderr.columns || 80;
  const suffix = elapsed >= 1000 ? ` ${formatDuration(elapsed)}` : "";
  let text = `${FRAMES[frame % FRAMES.length]} ${active.text}…${suffix}`;
  if (text.length > width - 1) text = text.slice(0, Math.max(0, width - 2)) + "…";
  process.stderr.write(`\r\x1b[2K${text}`);
}

function clear(): void {
  if (interactive()) process.stderr.write("\r\x1b[2K");
}

type ConsoleMethod = "log" | "warn" | "error" | "info";
const METHODS: ConsoleMethod[] = ["log", "warn", "error", "info"];
let originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> | undefined;

/** While the spinner shows, other output clears it first and redraws it after. */
function patchConsole(): void {
  if (originals) return;
  originals = {};
  for (const method of METHODS) {
    const original = console[method].bind(console) as (...args: unknown[]) => void;
    originals[method] = original;
    console[method] = (...args: unknown[]) => {
      clear();
      original(...args);
      render();
    };
  }
}

function restoreConsole(): void {
  if (!originals) return;
  for (const method of METHODS) if (originals[method]) console[method] = originals[method];
  originals = undefined;
}

/** Show a spinner for `text` until `stop` (or the next `spin`) replaces it. */
export function spin(text: string): void {
  active = { text, started: Date.now() };
  if (!interactive()) return;
  patchConsole();
  render();
  timer ??= setInterval(() => { frame++; render(); }, INTERVAL);
  timer.unref?.();
}

/** Remove the spinner; returns how long it ran. */
export function stop(): number {
  const elapsed = active ? Date.now() - active.started : 0;
  if (timer) clearInterval(timer);
  timer = undefined;
  clear();
  active = undefined;
  restoreConsole();
  return elapsed;
}

/**
 * Run one phase with a spinner, then print `✓ <done> (time)`. `done` may use
 * the result; returning undefined prints nothing. Failures print `✗ <text>`.
 */
export async function step<T>(
  text: string, work: () => Promise<T>, done: string | ((result: T) => string | undefined) = text,
): Promise<T> {
  const previous = active;
  spin(text);
  try {
    const result = await work();
    const elapsed = stop();
    const line = typeof done === "function" ? done(result) : done;
    if (line) console.log(`✓ ${line} (${formatDuration(elapsed)})`);
    return result;
  } catch (error) {
    const elapsed = stop();
    console.log(`✗ ${text} (${formatDuration(elapsed)})`);
    throw error;
  } finally {
    if (previous) spin(previous.text);
  }
}

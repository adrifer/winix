// Terminal styling: ANSI colours on interactive output only (never when piped,
// in CI, or with NO_COLOR), and plain English plurals.

const CODES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, magenta: 35, cyan: 36 } as const;
export type Style = keyof typeof CODES;
export type Paint = (style: Style, text: string) => string;

export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  return stream.isTTY === true && !process.env.NO_COLOR && !process.env.CI && process.env.TERM !== "dumb";
}

export function painter(enabled: boolean): Paint {
  return enabled ? (style, text) => (text ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text) : (_style, text) => text;
}

/** "1 change", "2 changes"; pass the plural when it is not just "+s". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

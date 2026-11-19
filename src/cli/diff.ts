// Line-based unified diff (Myers' O((N+M)D) algorithm), for `winix apply --diff`.

type Op = { kind: " " | "-" | "+"; line: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffLines(a: string[], b: string[]): Op[] {
  // Common prefix and suffix are cheap to strip and keep D (and memory) small.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
         a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const head: Op[] = a.slice(0, prefix).map((line) => ({ kind: " ", line }));
  const tail: Op[] = a.slice(a.length - suffix).map((line) => ({ kind: " ", line }));
  const x0 = a.slice(prefix, a.length - suffix);
  const y0 = b.slice(prefix, b.length - suffix);
  return [...head, ...myers(x0, y0), ...tail];
}

function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: "+", line }));
  if (m === 0) return a.map((line) => ({ kind: "-", line }));
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v after step d for k in [-d, d], stored at k + d.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) found = d;
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const previous = trace[d - 1];
    const at = (k: number) => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ kind: " ", line: a[x - 1] }); x--; y--; }
    if (down) ops.push({ kind: "+", line: b[prevY] });
    else ops.push({ kind: "-", line: a[prevX] });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { ops.push({ kind: " ", line: a[x - 1] }); x--; y--; }
  return ops.reverse();
}

/** A unified diff of two texts, or "" when they are equal. */
export function unifiedDiff(before: string, after: string, oldName: string, newName: string, context = 3): string {
  if (before === after) return "";
  const ops = diffLines(splitLines(before), splitLines(after));
  const changes = ops.flatMap((op, index) => op.kind === " " ? [] : [index]);
  if (changes.length === 0) {
    // Only a trailing newline differs.
    return `--- ${oldName}\n+++ ${newName}\n\\ Files differ only in their final newline\n`;
  }
  const ranges: [number, number][] = [];
  for (const index of changes) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  // Line numbers before each op.
  const oldLine: number[] = [];
  const newLine: number[] = [];
  let o = 1;
  let p = 1;
  for (const op of ops) {
    oldLine.push(o);
    newLine.push(p);
    if (op.kind !== "+") o++;
    if (op.kind !== "-") p++;
  }
  const out = [`--- ${oldName}`, `+++ ${newName}`];
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end + 1);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const oldStart = oldCount === 0 ? oldLine[start] - 1 : oldLine[start];
    const newStart = newCount === 0 ? newLine[start] - 1 : newLine[start];
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  return out.join("\n") + "\n";
}

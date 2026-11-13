export function nodeTypeArguments(version: string): string[] {
  const parsed = /^v?(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!parsed || ![22, 24, 26].includes(Number(parsed[1])) ||
      Number(parsed[1]) === 22 && Number(parsed[2]) < 13) {
    throw new Error(`Winix npm requires stable Node 22.13+, 24.x or 26.x; found ${version}. Node 24 supports transformation; Node 26 supports erasable TypeScript only.`);
  }
  return Number(parsed[1]) >= 26 ? [] : ["--experimental-transform-types"];
}

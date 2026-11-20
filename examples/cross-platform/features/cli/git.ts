import { feature } from "@adrifer/winix";

/**
 * Git settings shared by every machine. One object, rendered twice: Home
 * Manager writes it on Linux and macOS, and `gitConfig()` turns it into the
 * file Git for Windows reads.
 */
const settings = {
  init: { defaultBranch: "main" },
  user: { name: "Alice Example", email: "alice@example.com" },
  pull: { rebase: true },
  alias: { lg: "log --graph --oneline --decorate" },
};

/** Applied inside ~/work on every platform. */
const work = { user: { email: "alice@work.example" } };

export const git = feature("git", ({ home, windows }) => {
  // Linux and macOS: Home Manager installs git and writes ~/.config/git/config.
  home.program("git", {
    settings,
    includes: [{ condition: "gitdir:~/work/", contents: work }],
  });

  // Windows: install Git for Windows and write %USERPROFILE%\.gitconfig.
  // An existing file is moved to .gitconfig.bak the first time.
  windows.package("Git.Git");
  windows.file.text(windows.knownFolder.userProfile(".gitconfig-work"), gitConfig(work));
  windows.file.text(windows.knownFolder.userProfile(".gitconfig"), gitConfig({
    ...settings,
    includeIf: { "gitdir:~/work/": { path: "~/.gitconfig-work" } },
  }));
});

type GitSection = { [key: string]: string | number | boolean | GitSection };

/**
 * Render `{ section: { key: value, subsection: { key: value } } }` in git's
 * config format. Covers sections, one level of subsections and scalar
 * values; repeated keys (multi-valued settings) are not supported.
 */
export function gitConfig(sections: Record<string, GitSection>): string {
  const lines: string[] = [];
  const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const scalar = (value: string | number | boolean) => {
    const text = String(value);
    return /^\s|\s$|[;#"\\]/.test(text) ? quote(text) : text;
  };
  const section = (header: string, entries: GitSection) => {
    const values = Object.entries(entries).filter(([, value]) => typeof value !== "object");
    const nested = Object.entries(entries).filter(([, value]) => typeof value === "object");
    if (values.length > 0) {
      lines.push(`[${header}]`);
      for (const [key, value] of values) lines.push(`\t${key} = ${scalar(value as string | number | boolean)}`);
    }
    for (const [name, value] of nested) {
      if (header.includes('"')) throw new Error(`gitConfig supports one subsection level: ${header} ${name}`);
      section(`${header} ${quote(name)}`, value as GitSection);
    }
  };
  for (const [name, entries] of Object.entries(sections)) section(name, entries);
  return lines.join("\n") + "\n";
}

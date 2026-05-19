import { analyzeWorkspace } from "../analysis.ts";
import { loadWorkspace } from "../loader.ts";

export async function inspect(cwd: string): Promise<void> {
  const { workspace, configPath } = await loadWorkspace(cwd);
  const analyses = analyzeWorkspace(workspace);

  console.log(`Config: ${configPath}`);
  console.log(`Hosts: ${analyses.length}`);
  for (const analysis of analyses) {
    console.log(`\n${analysis.name}`);
    console.log(`  platform: ${analysis.platform}`);
    console.log(`  fragments: ${analysis.fragments.map((f) => f.label).join(" -> ")}`);
    for (const scope of ["nixos", "homeManager", "darwin"] as const) {
      const keys = new Set<string>();
      for (const record of analysis.fragments) {
        const data = record.fragment[scope];
        if (data) Object.keys(data).forEach((key) => keys.add(key));
      }
      if (keys.size > 0) {
        console.log(`  ${scope}: ${[...keys].join(", ")}`);
      }
    }
  }
}

import type { WindowsOutput } from "../../src/backends/windows/index.ts";

/**
 * A host's resources as readable text, for substring assertions: names,
 * dependencies, elevation, package versions, commands, raw scripts and DSC
 * properties (JSON).
 */
export function windowsText(output: WindowsOutput, hostName: string): string {
  const resources = output.resources[hostName];
  if (!resources) throw new Error(`no Windows host ${hostName}`);
  return resources.map((resource) => [
    `  - name: "${resource.name}"`,
    `    type: ${resource.type}`,
    ...(resource.dependsOn.length > 0 ? [`    dependsOn: [${resource.dependsOn.map((name) => `"${name}"`).join(", ")}]`] : []),
    ...(resource.elevated ? ["    elevated: true"] : []),
    ...(resource.package ? [`    package: ${resource.package.id} ${resource.package.version ?? "(presence only)"}`] : []),
    ...(resource.command ? [`    command: ${[resource.command.executable, ...resource.command.arguments].join(" ")}`] : []),
    ...(resource.testScript !== undefined ? ["    testScript:", resource.testScript] : []),
    ...(resource.setScript !== undefined ? ["    setScript:", resource.setScript] : []),
    ...(resource.properties ? [`    properties: ${JSON.stringify(resource.properties)}`] : []),
  ].join("\n")).join("\n");
}

import type { PackageRef } from "@adrifer/winix/types";

export interface NixosGenerated extends Record<string, unknown> {
  services?: NixosGeneratedServices;
}

export interface NixosGeneratedServices extends Record<string, unknown> {
  openssh?: {
    enable?: boolean;
    package?: PackageRef;
  };
}

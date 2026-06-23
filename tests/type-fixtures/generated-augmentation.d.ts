import type { NixosGenerated, NixosGeneratedServices } from "./generated-nixos";

declare module "@adrifer/winix/types" {
  interface NixosOptions extends NixosGenerated {}
  interface ServicesOptions extends NixosGeneratedServices {}
}

declare module "@adrifer/winix" {
  interface NixosOptions extends NixosGenerated {}
  interface ServicesOptions extends NixosGeneratedServices {}
}

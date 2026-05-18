import type { NixosGenerated, NixosGeneratedServices } from "./generated-nixos";

declare module "winix/types" {
  interface NixosOptions extends NixosGenerated {}
  interface ServicesOptions extends NixosGeneratedServices {}
}

declare module "winix" {
  interface NixosOptions extends NixosGenerated {}
  interface ServicesOptions extends NixosGeneratedServices {}
}

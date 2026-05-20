/// <reference path="bundled/nixos.d.ts" />
/// <reference path="bundled/home-manager.d.ts" />
/// <reference path="bundled/darwin.d.ts" />

// This file ensures bundled type augmentations are loaded when winix types are used.
// The bundled .d.ts files augment "winix" interfaces (NixosProgramOptions, HomeProgramOptions, etc.)
// with generated option types from NixOS, Home Manager, and nix-darwin.
export {};

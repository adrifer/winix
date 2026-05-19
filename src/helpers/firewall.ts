import type { Fragment } from "../core/types.ts";

export interface FirewallHelper {
  tcp(...ports: number[]): Fragment;
  udp(...ports: number[]): Fragment;
}

export const firewall: FirewallHelper = {
  tcp: (...ports: number[]): Fragment => ({
    nixos: {
      networking: {
        firewall: {
          allowedTCPPorts: ports,
        },
      },
    },
  }),
  udp: (...ports: number[]): Fragment => ({
    nixos: {
      networking: {
        firewall: {
          allowedUDPPorts: ports,
        },
      },
    },
  }),
};

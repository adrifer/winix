/**
 * Example of a third-party fragment package.
 * This would be published as `winix-fragment-tailscale` on npm.
 *
 * Usage:
 *   import { tailscale } from "winix-fragment-tailscale";
 *   host("server", [ nixos(), tailscale({ exitNode: true }) ]);
 */
import { nixos, type Fragment } from "@adrifer/winix";

interface TailscaleOpts {
  /** Act as an exit node for the tailnet */
  exitNode?: boolean;
  /** Auth key for headless enrollment */
  authKey?: string;
  /** Accept routes advertised by other nodes */
  acceptRoutes?: boolean;
}

/**
 * @description Tailscale mesh VPN
 * @example tailscale({ exitNode: true })
 * @category networking
 */
export function tailscale(opts?: TailscaleOpts): Fragment {
  return nixos({
    services: {
      tailscale: {
        enable: true,
        extraUpFlags: [
          ...(opts?.exitNode ? ["--advertise-exit-node"] : []),
          ...(opts?.acceptRoutes ? ["--accept-routes"] : []),
        ],
        authKeyFile: opts?.authKey,
      },
    },
    networking: {
      firewall: {
        trustedInterfaces: ["tailscale0"],
      },
    },
  });
}

import { feature } from "winix";

/**
 * @description Kernel sysctl tuning for development workloads (inotify, unprivileged ports)
 * @example workSysctl()
 * @category system
 */
export const workSysctl = feature("work-sysctl", () => ({
  nixos: {
    boot: {
      kernel: {
        sysctl: {
          "net.ipv4.ip_unprivileged_port_start": 443,
          "fs.inotify.max_user_watches": 1048576,
          "fs.inotify.max_user_instances": 1024,
          "fs.inotify.max_queued_events": 65536,
        },
      },
    },
  },
}));

import type { Fragment } from "winix";

const generated: Fragment = {
  nixos: {
    services: {
      openssh: {
        enable: true,
        package: "openssh",
      },
    },
  },
};

void generated;

const badGenerated: Fragment = {
  nixos: {
    services: {
      openssh: {
        // @ts-expect-error generated known option type should be enforced
        enable: "yes",
      },
    },
  },
};

void badGenerated;

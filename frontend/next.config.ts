import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["shared"],
  images: {
    // next/image refuses remote hosts that are not listed here, so that a
    // compromised or mistaken poster URL cannot turn the optimizer into an open
    // proxy for arbitrary images. picsum.photos serves the seed placeholders;
    // replace this entry when real artwork gets a home.
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["shared"],
  images: {
    // next/image refuses remote hosts that are not listed here, so that a
    // compromised or mistaken poster URL cannot turn the optimizer into an open
    // proxy for arbitrary images. image.tmdb.org serves real film posters and
    // picsum.photos the placeholder event artwork.
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;

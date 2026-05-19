import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/accounting',
        basePath: false,
      },
    ];
  },
};

export default nextConfig;

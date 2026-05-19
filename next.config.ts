import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  async redirects() {
    return [
      {
        source: '/',
        destination: '/accounting',
        permanent: true,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;

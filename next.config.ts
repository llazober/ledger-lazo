import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  experimental: {
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;

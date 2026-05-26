import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/accounting',
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
  experimental: {
    webpackBuildWorker: false,
    webpackMemoryOptimizations: true,
    workerThreads: false,
    cpus: 1,
  },
};

export default nextConfig;

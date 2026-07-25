import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  ...(process.env.NODE_ENV === "production"
    ? {}
    : { distDir: ".next/dev" }),
  experimental: {
    externalDir: true
  }
};

export default nextConfig;

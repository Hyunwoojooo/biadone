import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'"
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" }
        ]
      }
    ];
  },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  ...(process.env.NODE_ENV === "production"
    ? {}
    : { distDir: ".next/dev" }),
  experimental: {
    externalDir: true
  }
};

export default nextConfig;

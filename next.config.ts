// Next.js config. `output: "standalone"` produces a self-contained server bundle
// (.next/standalone) that the Dockerfile copies into the runtime image — the same
// pattern pm-ai-toolkit uses for its own Cloud Run deploy.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;

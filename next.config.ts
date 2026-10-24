import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The webhooks and dashboard pages read client configs (and provisioning state),
  // prompts and KB files from disk at runtime, so make sure Vercel ships them with
  // every server function, pages included. The test personas are read by the
  // dashboard's "Run tests" route.
  outputFileTracingIncludes: {
    "/**": ["./configs/**", "./prompts/**", "./kb/**", "./tests/personas/**"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The webhooks and dashboard pages read client configs (and provisioning state),
  // prompts and KB files from disk at runtime, so make sure Vercel ships them with
  // every server function, pages included.
  outputFileTracingIncludes: {
    "/**": ["./configs/**", "./prompts/**", "./kb/**"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The webhooks read client configs, prompts and KB files from disk at runtime,
  // so make sure Vercel ships them with the functions.
  outputFileTracingIncludes: {
    "/api/**": ["./configs/**", "./prompts/**", "./kb/**"],
  },
};

export default nextConfig;

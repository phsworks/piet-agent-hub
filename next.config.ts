import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  allowedDevOrigins: ["127.0.0.1", "localhost", ...(process.env.TAILSCALE_HOST ? [process.env.TAILSCALE_HOST] : [])],
  // Parses PDFs/Office files with Node APIs; keep it out of the server bundle.
  serverExternalPackages: ["officeparser"],
};

export default nextConfig;

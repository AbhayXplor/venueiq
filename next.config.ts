import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-only: which Host values the dev server will serve assets for. Both
  // loopback spellings are listed because tools (and people) reach for
  // 127.0.0.1 as often as localhost, and an unlisted origin means the page
  // loads but its client bundle is refused — which looks like a broken app.
  // Add a LAN host here if you open the dev server from another machine.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  reactStrictMode: false,
};

export default nextConfig;

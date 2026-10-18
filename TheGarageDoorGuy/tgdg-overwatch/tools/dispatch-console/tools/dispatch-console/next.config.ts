import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // The alerts service worker must never be served from an old cache, or a fix would not reach phones.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;

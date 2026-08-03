/** @type {import('next').NextConfig} */
const path = require("node:path");
const development = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
  // O popup oficial do Meta Embedded Signup precisa manter a relação com sua janela de origem.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      `img-src 'self' data: blob: https:${development ? " http://localhost:3001" : ""}`,
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline' https://connect.facebook.net${development ? " 'unsafe-eval'" : ""}`,
      `connect-src 'self' ws: wss: https://www.facebook.com https://graph.facebook.com https://connect.facebook.net${development ? " http://localhost:3001 ws://localhost:3001" : ""}`,
      "frame-src 'self' https://www.openstreetmap.org https://www.facebook.com https://web.facebook.com",
      "worker-src 'self' blob:",
      ...(development ? [] : ["upgrade-insecure-requests"]),
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@chegowia/shared"],
  images: {
    remotePatterns: [],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const path = require("node:path");
const development = process.env.NODE_ENV !== "production";

/**
 * CSP precisa conhecer a origem externa da API no momento do build. Não usamos
 * `ws:`/`wss:` amplos: isso permitiria conexões em tempo real para qualquer
 * host. Em vez disso, liberamos apenas a origem HTTP configurada e sua
 * contraparte WebSocket.
 */
function configuredOrigin(value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function websocketOrigin(origin) {
  if (!origin) return null;
  if (origin.startsWith("https://")) return origin.replace("https://", "wss://");
  if (origin.startsWith("http://")) return origin.replace("http://", "ws://");
  return null;
}

const apiOrigin = configuredOrigin(process.env.NEXT_PUBLIC_API_URL);
const apiSocketOrigin = websocketOrigin(apiOrigin);
const apiConnectSources = [apiOrigin, apiSocketOrigin].filter(Boolean);
const developmentConnectSources = development
  ? ["http://localhost:3001", "ws://localhost:3001"]
  : [];

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
      [
        "connect-src 'self'",
        ...apiConnectSources,
        "https://www.facebook.com",
        "https://graph.facebook.com",
        "https://connect.facebook.net",
        ...developmentConnectSources,
      ].join(" "),
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@chegowia/shared"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
  },
};

module.exports = nextConfig;

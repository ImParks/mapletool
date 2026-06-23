/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "open.api.nexon.com" },
      { protocol: "https", hostname: "**.nexon.com" },
    ],
  },
};

export default nextConfig;

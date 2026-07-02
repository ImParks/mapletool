/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dockerfile이 이 출력을 이용해 node_modules 없이도 실행 가능한 최소 이미지를 만든다.
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "open.api.nexon.com" },
      { protocol: "https", hostname: "**.nexon.com" },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // 構建時不因型別檢查中斷部署
    ignoreBuildErrors: true,
  },
  eslint: {
    // 構建時不因 ESLint 警告中斷部署
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
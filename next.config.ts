import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/dashboard/campaigns",
        destination: "/dashboard/agent#learning",
        permanent: false,
      },
      {
        source: "/dashboard/plays",
        destination: "/dashboard/agent#learning",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

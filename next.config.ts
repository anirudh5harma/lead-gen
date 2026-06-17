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
      {
        source: "/dashboard/integrations",
        destination: "/dashboard/settings#email",
        permanent: false,
      },
      {
        source: "/dashboard/deliverability",
        destination: "/dashboard/settings#email",
        permanent: false,
      },
      {
        source: "/dashboard/prospecting",
        destination: "/dashboard/settings#profile",
        permanent: false,
      },
      {
        source: "/dashboard/setup",
        destination: "/dashboard/settings#profile",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

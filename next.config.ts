import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
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
        destination: "/dashboard/settings#channels",
        permanent: false,
      },
      {
        source: "/dashboard/deliverability",
        destination: "/dashboard/settings#channels",
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
      {
        source: "/dashboard/signals",
        destination: "/dashboard/agent#opportunities",
        permanent: false,
      },
      {
        source: "/dashboard/ingestion",
        destination: "/dashboard/agent#opportunities",
        permanent: false,
      },
      {
        source: "/dashboard/prospects",
        destination: "/dashboard/agent#verified-contacts",
        permanent: false,
      },
      {
        source: "/dashboard/conversations",
        destination: "/dashboard/agent#outreach",
        permanent: false,
      },
      {
        source: "/dashboard/outcomes",
        destination: "/dashboard/brief",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

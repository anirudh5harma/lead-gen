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
        destination: "/dashboard/profile#tools",
        permanent: false,
      },
      {
        source: "/dashboard/deliverability",
        destination: "/dashboard/profile#channels",
        permanent: false,
      },
      {
        source: "/dashboard/prospecting",
        destination: "/dashboard/profile#profile",
        permanent: false,
      },
      {
        source: "/dashboard/setup",
        destination: "/dashboard/profile#profile",
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
        source: "/dashboard/prospects/:id",
        destination: "/dashboard/agent/contacts/:id",
        permanent: false,
      },
      {
        source: "/dashboard/conversations",
        destination: "/dashboard/agent#outreach",
        permanent: false,
      },
      {
        source: "/dashboard/review",
        destination: "/dashboard/agent#opportunities",
        permanent: false,
      },
      {
        source: "/dashboard/approvals",
        destination: "/dashboard/agent#opportunities",
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

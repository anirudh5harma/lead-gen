export interface DefaultNewsQuery {
  query: string;
  name: string;
  signal_kind:
    | "funding"
    | "acquisition"
    | "leadership_change"
    | "product_launch"
    | "expansion"
    | "regulation"
    | "churn_risk"
    | "competitor_move"
    | "press_mention";
  poll_interval_minutes: number;
  source_tier: "aggregator";
  source_authority: number;
  source_reason: string;
}

export const DEFAULT_GOOGLE_NEWS_QUERIES: DefaultNewsQuery[] = [
  {
    query: "startup funding round Series A B C",
    name: "Funding — Series A–C",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "startup raises seed round",
    name: "Funding — Seed",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "startup raises pre-seed funding",
    name: "Funding — Pre-seed",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "AI startup raises funding",
    name: "Funding — AI",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "SaaS company fundraising venture capital",
    name: "Funding — SaaS/VC",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "fintech startup raised million funding",
    name: "Funding — Fintech",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_funding_recall",
  },
  {
    query: "company acquisition deal announced tech",
    name: "Acquisition — Tech",
    signal_kind: "acquisition",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_ma_recall",
  },
  {
    query: "startup acquired by company",
    name: "Acquisition — Startup",
    signal_kind: "acquisition",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_ma_recall",
  },
  {
    query: "company hires new CTO CPO CISO CFO",
    name: "Leadership — C-suite hire",
    signal_kind: "leadership_change",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_leadership_recall",
  },
  {
    query: "company appoints new CEO CFO CTO",
    name: "Leadership — Appointment",
    signal_kind: "leadership_change",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_leadership_recall",
  },
  {
    query: "company launches new product platform",
    name: "Product launch",
    signal_kind: "product_launch",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_launch_recall",
  },
  {
    query: "company expansion new market launch",
    name: "Expansion — new market",
    signal_kind: "expansion",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_expansion_recall",
  },
  {
    query: "company data breach security incident compliance",
    name: "Pain — data breach",
    signal_kind: "churn_risk",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_pain_recall",
  },
  {
    query: "company issues RFP software vendor",
    name: "Pain — RFP/vendor search",
    signal_kind: "churn_risk",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_pain_recall",
  },
  {
    query: "company migrates to new platform cloud",
    name: "Pain — cloud migration",
    signal_kind: "churn_risk",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_pain_recall",
  },
  {
    query: "company signs contract digital transformation",
    name: "Intent — digital transformation",
    signal_kind: "competitor_move",
    poll_interval_minutes: 30,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_intent_recall",
  },
  {
    query: "company fined regulatory compliance",
    name: "Regulation — enforcement",
    signal_kind: "regulation",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_regulation_recall",
  },
  {
    query: "company cuts costs automation initiative",
    name: "Pain — cost cutting",
    signal_kind: "churn_risk",
    poll_interval_minutes: 60,
    source_tier: "aggregator",
    source_authority: 0.66,
    source_reason: "free_pain_recall",
  },
];

export interface DefaultRssFeed {
  url: string;
  name: string;
  signal_kind: "press_mention" | "funding" | "product_launch" | "regulation";
  poll_interval_minutes: number;
  source_tier: "trusted";
  source_authority: number;
  source_reason: string;
}

export const DEFAULT_RSS_FEEDS: DefaultRssFeed[] = [
  {
    url: "https://techcrunch.com/category/startups/feed/",
    name: "TechCrunch — Startups",
    signal_kind: "press_mention",
    poll_interval_minutes: 30,
    source_tier: "trusted",
    source_authority: 0.78,
    source_reason: "curated_tech_press",
  },
  {
    url: "https://www.finsmes.com/feed",
    name: "FINsMES",
    signal_kind: "funding",
    poll_interval_minutes: 30,
    source_tier: "trusted",
    source_authority: 0.7,
    source_reason: "curated_funding_press",
  },
  {
    url: "https://venturebeat.com/category/ai/feed/",
    name: "VentureBeat — AI",
    signal_kind: "press_mention",
    poll_interval_minutes: 60,
    source_tier: "trusted",
    source_authority: 0.75,
    source_reason: "curated_ai_press",
  },
  {
    url: "https://www.sec.gov/news/pressreleases.rss",
    name: "SEC press releases",
    signal_kind: "regulation",
    poll_interval_minutes: 60,
    source_tier: "trusted",
    source_authority: 0.9,
    source_reason: "official_regulator",
  },
];

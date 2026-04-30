const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'CRON_SECRET',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
] as const

const OPTIONAL_WITH_WARNINGS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_PUBSUB_TOPIC',
  'GMAIL_WEBHOOK_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_REDIRECT_URI',
  'NEXT_PUBLIC_ENABLE_GMAIL_CONNECT',
  'ZEROBOUNCE_API_KEY',
  'FULLENRICH_API_KEY',
  'HUNTER_API_KEY',
  'FIRECRAWL_API_KEY',
  'DODO_API_KEY',
  'DODO_WEBHOOK_SECRET',
  'DODO_PRODUCT_LEAD_CREDITS',
  'DODO_BUSINESS_ID',
  'INTERNAL_OPS_ALLOWED_EMAILS',
  'INTERNAL_OPS_SECRET',
] as const

export function validateEnv(): void {
  const missing = REQUIRED.filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  const warnings = OPTIONAL_WITH_WARNINGS.filter(k => !process.env[k])
  if (warnings.length) {
    console.warn(`[env] Optional env vars not set (some features will be disabled): ${warnings.join(', ')}`)
  }
}

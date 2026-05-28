export async function sendSlackAlert(
  webhookUrl: string,
  companyName: string,
  signalType: string,
  headline: string,
  score: number,
): Promise<void> {
  const emoji: Record<string, string> = {
    funding: '💰', acquisition: '🤝', expansion: '🌍', hiring: '👥', regulation: '⚖️',
  }
  const payload = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji[signalType] ?? '⚡'} *${signalType.charAt(0).toUpperCase() + signalType.slice(1)} Signal* — Relevance ${score}/10`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Company*\n${companyName}` },
          { type: 'mrkdwn', text: `*Signal*\n${headline}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View in Bombsell' },
            url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
          },
        ],
      },
    ],
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  })
}

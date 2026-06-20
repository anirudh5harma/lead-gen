import type { Metadata } from 'next'
import { LegalPage, type LegalPageProps } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service | Bombsell',
  description: 'The terms governing access to and use of Bombsell.',
}

const sections: LegalPageProps['sections'] = [
  {
    title: 'Using Bombsell',
    paragraphs: [
      'These Terms of Service govern your access to and use of Bombsell. By creating an account, connecting an integration, or using the service, you agree to these terms.',
      'You must be at least 18 years old and legally able to enter into a binding agreement on behalf of yourself or the business you represent.',
    ],
  },
  {
    title: 'Accounts and Access',
    items: [
      'You are responsible for keeping your login credentials secure and for all activity that occurs under your account.',
      'You must provide accurate account, billing, and workspace information and keep it reasonably up to date.',
      'You may not share access in a way that bypasses plan limits or otherwise undermines product controls.',
    ],
  },
  {
    title: 'Subscriptions, Limits, and Payments',
    paragraphs: [
      'Paid plans renew automatically until cancelled. Fees are charged according to the plan, billing cycle, and any prepaid credit or top-up terms you accepted at checkout or in-product.',
      'Feature access, lead quotas, client workspace limits, and sending limits are tied to your current plan. If you downgrade or your subscription ends, Bombsell may restrict access to paid-only functionality or reduce workspace capacity to match your active plan.',
    ],
  },
  {
    title: 'Acceptable Use',
    items: [
      'Do not use Bombsell to send unlawful, deceptive, abusive, infringing, or spam content.',
      'Do not attempt to scrape, probe, reverse engineer, or interfere with the service beyond authorized product use.',
      'Do not upload data or connect accounts unless you have the right to do so and a lawful basis to contact the people in your outreach workflows.',
      'Do not use the service in a way that could harm Bombsell, other users, third-party providers, or recipients.',
    ],
  },
  {
    title: 'Your Data and Output',
    paragraphs: [
      'You retain ownership of the data, content, and source materials you submit to Bombsell. You grant Bombsell the rights needed to host, process, transmit, and analyze that data to operate the service.',
      'Bombsell may generate drafts, suggestions, rankings, and signals using automated systems and AI providers. You are responsible for reviewing output before sending or acting on it.',
    ],
  },
  {
    title: 'Third-Party Services',
    paragraphs: [
      'Bombsell depends on third-party services such as email providers, payment processors, enrichment vendors, AI providers, and hosting infrastructure. Their availability or performance may affect parts of the product, and Bombsell is not responsible for outages or changes controlled by those providers.',
    ],
  },
  {
    title: 'Intellectual Property',
    paragraphs: [
      'Bombsell and its software, design, branding, and related materials are owned by Bombsell or its licensors and are protected by applicable intellectual property laws. These terms do not grant you any ownership rights in the service other than the limited right to use it under your subscription.',
    ],
  },
  {
    title: 'Disclaimers and Liability',
    paragraphs: [
      'Bombsell is provided on an as-is and as-available basis. We do not guarantee that the service will be uninterrupted, error-free, or that signals, contact data, deliverability, or generated content will always be complete, accurate, or fit for a particular purpose.',
      'To the maximum extent allowed by law, Bombsell will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, goodwill, or business opportunities arising from your use of the service.',
    ],
  },
  {
    title: 'Suspension and Termination',
    paragraphs: [
      'We may suspend or terminate access if you breach these terms, create risk for Bombsell or others, fail to pay fees when due, or use the product in a way that violates law or provider policies. You may stop using the service at any time.',
    ],
  },
  {
    title: 'Changes and Contact',
    paragraphs: [
      'We may update these terms from time to time. When changes are material, we will update the effective date and may provide additional notice through the product or by email. Your continued use after the updated terms take effect means you accept the revised terms.',
      'Questions about these terms can be sent to team@bombsell.com.',
    ],
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of Service"
      intro="These terms describe the rules for using Bombsell, including account responsibilities, subscription limits, acceptable use, and the boundaries of our liability."
      updatedAt="April 23, 2026"
      sections={sections}
    />
  )
}

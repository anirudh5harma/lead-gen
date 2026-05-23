import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy | Bombsell',
  description: 'How Bombsell collects, uses, stores, and protects personal information.',
}

const sections = [
  {
    title: 'Information We Collect',
    paragraphs: [
      'Bombsell collects information you provide directly, such as your name, email address, company details, onboarding answers, billing details, connected inbox configuration, and any content you create or upload while using the product.',
      'We also collect product usage information such as log data, device and browser details, IP address, sign-in events, page interactions, and events tied to signal matching, outreach drafting, sending, follow-ups, and workspace activity.',
    ],
    items: [
      'Account details and authentication data from providers such as Google when you sign in.',
      'Company profile, ICP, website URL, targeting preferences, and outreach preferences you configure.',
      'Lead, contact, signal, and email performance data generated through your use of the service.',
    ],
  },
  {
    title: 'How We Use Information',
    paragraphs: [
      'We use personal information to provide and improve Bombsell, including operating your workspace, matching signals, enriching leads, generating outreach drafts, enabling email sending, processing payments, preventing abuse, and providing support.',
      'We may also use aggregated and de-identified product analytics to understand product performance, tune ranking systems, and improve matching and drafting quality.',
    ],
  },
  {
    title: 'How We Share Information',
    paragraphs: [
      'We do not sell your personal information. We share information only when needed to run the service, comply with the law, protect Bombsell and its users, or complete a business transfer such as a merger or acquisition.',
    ],
    items: [
      'Infrastructure, analytics, authentication, billing, and messaging vendors that help us operate Bombsell.',
      'Enrichment, verification, and AI providers used to discover contacts, process websites, or generate outreach content on your behalf.',
      'Law enforcement, regulators, or other parties when we are legally required to disclose information.',
    ],
  },
  {
    title: 'Connected Accounts and Customer Data',
    paragraphs: [
      'If you connect Gmail, Outlook, or other third-party tools, Bombsell accesses only the data necessary to provide the connected feature. We use inbox access to send email, detect replies, manage follow-up status, and display related outreach activity in your workspace.',
      'You are responsible for making sure you have the right to process the prospect and customer data you upload or generate through Bombsell.',
    ],
  },
  {
    title: 'Retention and Security',
    paragraphs: [
      'We retain information for as long as needed to provide the service, comply with legal obligations, resolve disputes, and enforce our agreements. When data is no longer required, we delete it or de-identify it within a commercially reasonable period.',
      'We use reasonable administrative, technical, and organizational safeguards to protect information. No system is perfectly secure, so we cannot guarantee absolute security.',
    ],
  },
  {
    title: 'Your Choices',
    items: [
      'You can update most profile and workspace information from within the app.',
      'You can disconnect integrations and stop connected sending at any time.',
      'You can request account deletion or ask privacy questions by emailing team@bombsell.com.',
    ],
  },
  {
    title: 'Children, International Use, and Changes',
    paragraphs: [
      'Bombsell is not intended for children under 18, and we do not knowingly collect personal information from children.',
      'If you use Bombsell from outside the country where our providers host data, you understand that your information may be transferred and processed in other jurisdictions.',
      'We may update this Privacy Policy from time to time. When we make material changes, we will update the effective date and may provide additional notice inside the product or by email.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'For privacy requests, questions, or complaints, contact us at team@bombsell.com.',
    ],
  },
] satisfies Parameters<typeof LegalPage>[0]['sections']

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      intro="This policy explains what information Bombsell collects, how we use it, when we share it, and the choices you have when using the product."
      updatedAt="April 23, 2026"
      sections={sections}
    />
  )
}

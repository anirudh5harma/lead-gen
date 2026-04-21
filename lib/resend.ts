import { Resend } from 'resend'

const FROM = 'Bombsell <team@bombsell.com>'

export async function sendFirstLeadEmail(toEmail: string, companyName: string, leadCompany: string, signalType: string) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const signalLabel: Record<string, string> = {
    funding: 'funding round',
    acquisition: 'acquisition',
    expansion: 'market expansion',
    regulation: 'regulation change',
    hiring: 'executive hire',
  }
  const label = signalLabel[signalType] ?? signalType

  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Your first lead just landed — ${leadCompany}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your first lead just landed</title>
</head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e8e2d9;overflow:hidden;">
      <!-- header -->
      <tr>
        <td style="background:#c15f3c;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">Bombsell</p>
        </td>
      </tr>
      <!-- body -->
      <tr>
        <td style="padding:36px 32px 24px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#1a1612;letter-spacing:-0.02em;">
            Your first lead just landed 🎉
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#6b5f52;line-height:1.55;">
            Bombsell just matched a <strong style="color:#1a1612;">${label}</strong> signal from
            <strong style="color:#1a1612;">${leadCompany}</strong> to your ICP profile.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#6b5f52;line-height:1.55;">
            Head to your dashboard to review the signal, see the drafted outreach, and send it while the context is fresh.
          </p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
             style="display:inline-block;background:#c15f3c;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:100px;font-size:14px;font-weight:500;letter-spacing:-0.01em;">
            View lead →
          </a>
        </td>
      </tr>
      <!-- divider -->
      <tr><td style="padding:0 32px;"><div style="height:1px;background:#e8e2d9;"></div></td></tr>
      <!-- footer -->
      <tr>
        <td style="padding:20px 32px;">
          <p style="margin:0;font-size:12px;color:#9c8f82;">
            You're receiving this because you signed up for Bombsell with ${companyName}.
            Signals run every hour — more leads are on the way.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  })
}

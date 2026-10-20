import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/*
  Public legal pages. Google requires a reachable privacy policy and terms
  link before an OAuth app can be published, and they are linked from the
  Google consent screen. Keep them accurate to what NCore actually does —
  if a data flow changes (new processor, new data type), update the policy in
  the same change.
*/

const CONTACT_EMAIL = 'omatic657@gmail.com';
const LAST_UPDATED = 'October 20, 2026';

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-950 text-surface-200">
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <Link to="/" className="text-sm text-nyptid-200 hover:text-nyptid-100">
          ← Back to NCore
        </Link>
        <h1 className="mt-6 text-3xl font-black text-surface-100">{title}</h1>
        <p className="mt-2 text-sm text-surface-500">Last updated {LAST_UPDATED}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-surface-100 [&_li]:ml-5 [&_li]:list-disc [&_a]:text-nyptid-200">
          {children}
        </div>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        NCore is a chat, voice and video app run by NYPTID Industries. This policy explains what
        we collect, why, and what you can do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: your email address, username, display name, and the profile you choose to set up (avatar, banner, bio, status).</li>
        <li>If you sign in with Google: your name, email address and profile picture from your Google account. We do not get access to your Gmail, contacts, Drive or anything else.</li>
        <li>Content you send: messages, attachments, reactions, and the servers, channels and group chats you create or join.</li>
        <li>Basic technical data: sign-in sessions, device type, and error reports, used to keep your account secure and the app working.</li>
      </ul>

      <h2>Direct messages and calls</h2>
      <p>
        Direct messages can be end-to-end encrypted. When they are, the message text is encrypted on
        your device and we store only ciphertext we cannot read. Voice and video calls are routed
        through our real-time media provider and are not recorded by NCore.
      </p>

      <h2>Discord import</h2>
      <p>
        If you use Discord import, your Discord data package is read on your own device. We store
        only one-way fingerprints of Discord account IDs so that friends who also import can be
        reconnected. We never store your Discord messages, usernames or friend list in readable form.
      </p>

      <h2>How we use your data</h2>
      <ul>
        <li>To run the service: deliver messages, connect calls, show your profile to people you talk to.</li>
        <li>To keep it safe: prevent spam and abuse, enforce blocks and bans, and protect accounts.</li>
        <li>To process payments if you buy a subscription. Card details go directly to our payment processor and never touch our servers.</li>
      </ul>
      <p>We do not sell your personal data, and we do not use your messages for advertising.</p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Supabase: database, sign-in and file storage.</li>
        <li>Vercel: hosting for the website.</li>
        <li>Agora: real-time voice and video.</li>
        <li>Resend: account emails such as confirmations and password resets.</li>
        <li>Stripe: payments, if you subscribe.</li>
        <li>Google: sign-in, if you choose "Continue with Google".</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>You can edit your profile, block people, and control who can message you in Settings.</li>
        <li>You can delete your account from Settings, which removes your profile and account data.</li>
        <li>You can ask us for a copy of your data or ask a question by emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
      </ul>

      <h2>Children</h2>
      <p>NCore is not intended for children under 13, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a meaningful way, we will update the date above and let users know in the app.</p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These terms cover your use of NCore, run by NYPTID Industries. By creating an account or
        using NCore you agree to them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old, or older where local law requires it.</li>
        <li>You are responsible for keeping your login secure and for activity on your account.</li>
        <li>Give accurate sign-up information and do not impersonate other people.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not use NCore to:</p>
      <ul>
        <li>harass, threaten or dox anyone, or promote violence against people;</li>
        <li>share content that sexualizes minors, non-consensual intimate imagery, or anything illegal;</li>
        <li>spam, scam, distribute malware, or try to break into accounts or our systems;</li>
        <li>infringe other people's copyrights or trademarks.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>

      <h2>Your content</h2>
      <p>
        You own what you post. You give us the permission we need to store it and deliver it to the
        people you send it to. You are responsible for what you post.
      </p>

      <h2>Paid features</h2>
      <p>
        Subscriptions renew automatically until you cancel, and you can cancel at any time from
        Settings. Cancelling stops future charges; access continues until the end of the period you
        already paid for.
      </p>

      <h2>The service</h2>
      <p>
        We work to keep NCore available, but it is provided "as is" and may change, have downtime, or
        lose features. To the extent the law allows, NYPTID Industries is not liable for indirect or
        consequential losses from using NCore.
      </p>

      <h2>Ending your use</h2>
      <p>You can stop using NCore and delete your account at any time.</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also
        our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalShell>
  );
}

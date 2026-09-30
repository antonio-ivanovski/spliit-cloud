import { LegalPage } from './legal-page'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" lastUpdated="September 30, 2026">
      <p>
        Spliit Cloud is a non-commercial, community-maintained project. This
        notice explains what personal data the public Spliit Cloud instance
        processes, why, who receives it, how long it is kept, and the controls
        available to you.
      </p>

      <section>
        <h3>Categories of personal data</h3>
        <ul>
          <li>
            Account data: email address, display name, avatar, sign-in method,
            session information, IP address, and user agent.
          </li>
          <li>
            Shared-group data: participant names, expenses, amounts, currencies,
            dates, notes, categories, balances, invitations, and activity
            records.
          </li>
          <li>
            Files you choose to upload, such as receipt images or documents.
          </li>
          <li>
            Messages needed to send verification, sign-in, password-reset,
            invitation, and activity-notification emails.
          </li>
        </ul>
      </section>

      <section>
        <h3>Purposes of use</h3>
        <p>
          We use this data to provide accounts, shared expense tracking,
          invitations, exports, security, support, and the optional features you
          ask us to use. We do not sell personal data or run third-party
          advertising or analytics trackers in the current application.
        </p>
      </section>

      <section>
        <h3>Recipients and service providers</h3>
        <p>
          The service runs on hosting, database, backup, object-storage, and
          email infrastructure (currently Cloudflare Pages, a Hetzner-hosted API
          and PostgreSQL database, Cloudflare R2 backups and uploads, and a
          configured SMTP provider). These providers process data only to
          operate the service. If you choose receipt extraction or expense
          categorisation, relevant receipt images, voice recordings,
          transcripts, expense text, currency context, and recent expense
          context may be sent to the configured AI provider. Voice recordings
          are processed transiently and are not stored by Spliit. Do not use
          those features for material you are not comfortable sharing with that
          provider.
        </p>
      </section>

      <section>
        <h3>Connected applications</h3>
        <p>
          If you connect ChatGPT, Claude, or another OAuth application to your
          Spliit account, that application can access the groups, expenses, and
          balances your account can see, within the permissions you approved.
          Data sent through a connected application is also governed by that
          application&apos;s terms and privacy policy. You can review and
          disconnect connected applications at any time from your account
          settings; disconnecting stops future access but does not delete data
          the application already received.
        </p>
      </section>

      <section>
        <h3>Cookies and local storage</h3>
        <p>
          We use an essential, HTTP-only session cookie to keep you signed in.
          We also store functional preferences such as language, theme, and
          group-view choices in your browser. We do not use advertising or
          analytics cookies.
        </p>
      </section>

      <section>
        <h3>Retention</h3>
        <ul>
          <li>
            Account and group data is kept while your account exists and while
            shared group records need it to stay consistent for other members.
          </li>
          <li>
            Session data expires with your sessions; signing out or revoking a
            session ends its access.
          </li>
          <li>
            Email delivery records and rotating database backups age out as new
            ones replace them.
          </li>
          <li>
            If you delete your account or ask for deletion, shared records that
            other members rely on may be retained in anonymised form or
            separated from your account to preserve their history and meet
            legitimate operational needs.
          </li>
        </ul>
      </section>

      <section>
        <h3>Your controls</h3>
        <ul>
          <li>Export a group from the app at any time.</li>
          <li>
            Review and disconnect connected applications from your account
            settings.
          </li>
          <li>
            Ask about access, correction, deletion, or other privacy requests by
            emailing{' '}
            <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          For privacy questions or requests, contact{' '}
          <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>. For
          general help, see <a href="/support">support</a>.
        </p>
      </section>
    </LegalPage>
  )
}

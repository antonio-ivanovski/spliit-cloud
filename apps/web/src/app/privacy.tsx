import { LegalPage } from './legal-page'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <p>
        Spliit Cloud is a non-commercial, community-maintained project. This
        notice explains how the public Spliit Cloud instance handles personal
        data when you use it.
      </p>

      <section>
        <h3>What we process</h3>
        <ul>
          <li>
            Account data, including your email address, display name, avatar,
            sign-in method, session information, IP address, and user agent.
          </li>
          <li>
            Shared-group data, including participant names, expenses, amounts,
            currencies, dates, notes, categories, balances, invitations, and
            activity records.
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
        <h3>Why we use it</h3>
        <p>
          We use this data to provide accounts, shared expense tracking,
          invitations, exports, security, support, and the optional features you
          ask us to use. We do not sell personal data or run third-party
          advertising or analytics trackers in the current application.
        </p>
      </section>

      <section>
        <h3>Service providers and optional features</h3>
        <p>
          The service uses hosting, database, backup, object-storage, email, and
          authentication providers to operate. If you choose receipt extraction
          or expense categorisation, relevant receipt images, expense text,
          currency context, and recent expense context may be sent to the
          configured AI provider. Do not use those features for material you are
          not comfortable sharing with that provider.
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
        <h3>Retention and your choices</h3>
        <p>
          Data is kept while it is needed to provide the service or maintain
          shared group records. You can export a group from the app. You may ask
          about access, correction, deletion, or other privacy requests by
          emailing{' '}
          <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>. Some
          shared records may need to be retained, anonymised, or separated from
          your account to preserve other members&apos; records and meet
          legitimate operational or legal needs.
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          For privacy questions or requests, contact{' '}
          <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>.
        </p>
      </section>
    </LegalPage>
  )
}

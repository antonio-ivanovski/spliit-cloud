import { LegalPage } from './legal-page'

export default function SupportPage() {
  return (
    <LegalPage title="Support" lastUpdated="September 30, 2026">
      <p>
        Spliit Cloud is a non-commercial, community-maintained project. For help
        with your account, groups, or expenses, contact us and include enough
        detail to reproduce the issue.
      </p>

      <section>
        <h3>Contact us</h3>
        <p>
          Email <a href="mailto:contact@spliit.cloud">contact@spliit.cloud</a>{' '}
          from the address you use to sign in. Include what you were trying to
          do, what happened instead, and the group name or expense title when
          relevant. Never send passwords, recovery links, or one-time codes.
        </p>
        <p>
          We aim to reply within a few days. Spliit Cloud has no paid support
          tier and no guaranteed response time.
        </p>
      </section>

      <section>
        <h3>Before writing</h3>
        <ul>
          <li>
            Service status: check{' '}
            <a
              href="https://status.spliit.cloud/"
              target="_blank"
              rel="noreferrer"
            >
              status.spliit.cloud
            </a>{' '}
            for ongoing incidents.
          </li>
          <li>
            Bugs and ideas: open an issue from the{' '}
            <a href="/feedback">feedback page</a>, which also collects the
            browser diagnostics developers need.
          </li>
          <li>
            Privacy requests (access, correction, deletion, export): email{' '}
            <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>{' '}
            instead — see the <a href="/privacy">privacy notice</a>.
          </li>
          <li>
            Security issues: email{' '}
            <a href="mailto:security@spliit.cloud">security@spliit.cloud</a> and
            do not open a public issue.
          </li>
        </ul>
      </section>

      <section>
        <h3>Connected applications</h3>
        <p>
          If you connected ChatGPT, Claude, or another OAuth application to your
          Spliit account, review its access under account settings and
          disconnect it there if you no longer use it. Mention the application
          name and when you connected it when asking for help with a connection.
        </p>
      </section>
    </LegalPage>
  )
}

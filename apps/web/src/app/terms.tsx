import { LegalPage } from './legal-page'

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        Spliit Cloud is a free, non-commercial, community-maintained project. By
        accessing or using it, you agree to these terms.
      </p>

      <section>
        <h3>Use at your own discretion</h3>
        <p>
          Spliit Cloud is provided as-is and as available. It is a convenience
          tool for recording shared expenses, not a bank, payment service,
          accounting system, escrow service, or source of financial advice.
          Balances, calculations, imports, exports, notifications, and other
          outputs may be incomplete, delayed, inaccurate, unavailable, or lost.
          You are responsible for checking records and settling money directly
          with the people involved.
        </p>
      </section>

      <section>
        <h3>No guarantee</h3>
        <p>
          We do not promise uninterrupted, secure, error-free, compatible, or
          permanent operation. Data can be lost, altered, exposed, delayed, or
          become unavailable because of bugs, configuration errors, malicious
          actors, third-party providers, hardware or network failures, backups,
          user actions, or events outside anyone&apos;s control. Keep
          independent records of anything important.
        </p>
      </section>

      <section>
        <h3>Limitation of liability</h3>
        <p>
          To the maximum extent permitted by applicable law, the project and its
          contributors are not liable for any loss of money, data, profits,
          reputation, opportunity, or other direct, indirect, incidental,
          special, consequential, or punitive damage arising from or related to
          the service, its implementation, security, availability, data
          handling, or use by other people. Nothing in these terms excludes
          liability that cannot lawfully be excluded or limited.
        </p>
      </section>

      <section>
        <h3>Your responsibilities</h3>
        <p>
          Use the service lawfully, protect your account, and only upload or
          share information you have the right to use. Do not attempt to access
          other people&apos;s data, disrupt the service, or use it to harm
          others. You are responsible for your relationships, expense
          arrangements, payments, and decisions made using the service.
        </p>
      </section>

      <section>
        <h3>Changes and availability</h3>
        <p>
          The community may change, suspend, or discontinue any part of the
          service at any time, with or without notice. These terms may change;
          continued use after an update means you accept the updated terms.
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          Questions about these terms can be sent to{' '}
          <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>.
        </p>
      </section>
    </LegalPage>
  )
}

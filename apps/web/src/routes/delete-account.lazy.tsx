import { createLazyFileRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'

import { LegalPage } from '@/app/legal-page'

function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your Spliit Cloud account"
      lastUpdated="October 15, 2026"
    >
      <section>
        <h3>Request deletion online</h3>
        <p>
          You can request deletion without the Android app. Sign in on this
          website, open <Link to="/account/delete">account deletion</Link>,
          review what happens to your groups, and confirm the request. Deleting
          the Android app alone does not delete your Spliit Cloud account.
        </p>
      </section>
      <section>
        <h3>Timing and data retained</h3>
        <p>
          Deletion is scheduled after a 48-hour grace period, during which you
          can cancel it. Account credentials, sessions, and connected access are
          removed when deletion completes. Shared group records may remain
          detached from your account to preserve other participants’ expense
          history. The deletion screen explains the choices for your groups and
          participant name before you confirm. Rotating backups expire under the
          retention described in our <Link to="/privacy">privacy notice</Link>.
        </p>
      </section>
      <section>
        <h3>If you cannot sign in</h3>
        <p>
          Email <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>{' '}
          to request account and associated data deletion. We will verify
          ownership before acting. Never send passwords, recovery codes, or
          receipt files.
        </p>
      </section>
    </LegalPage>
  )
}

export const Route = createLazyFileRoute('/delete-account')({
  component: DeleteAccountPage,
})

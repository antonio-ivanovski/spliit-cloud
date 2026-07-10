import { LegalPage } from './legal-page'

export default function ImprintPage() {
  return (
    <LegalPage title="Project notice">
      <p>
        Spliit Cloud is a non-commercial, community-maintained software project
        developed in public through the Spliit Cloud GitHub repository.
      </p>

      <section>
        <h3>Project and source code</h3>
        <p>
          The project is maintained by community contributors. Its source code,
          issue tracker, and contributor information are available at{' '}
          <a
            href="https://github.com/antonio-ivanovski/spliit-cloud"
            target="_blank"
            rel="noreferrer"
          >
            github.com/antonio-ivanovski/spliit-cloud
          </a>
          .
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          For privacy, legal, or project-related questions, email{' '}
          <a href="mailto:privacy@spliit.cloud">privacy@spliit.cloud</a>.
        </p>
      </section>

      <section>
        <h3>Non-commercial project</h3>
        <p>
          Spliit Cloud is not offered by a registered business or company. This
          page identifies the project and its public contact channel; it does
          not create a commercial service relationship.
        </p>
      </section>
    </LegalPage>
  )
}

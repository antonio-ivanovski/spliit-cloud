import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { getStatusPageUrl } from '@/lib/status-page'

import githubSvg from '../auth/github.svg'

import './footer-art.css'

const GITHUB_URL = 'https://github.com/antonio-ivanovski/spliit-cloud'

/**
 * Inline GitHub link inside the open-source credit sentence. The icon is part
 * of the component so translators only own the link text inside `<github>`.
 */
function GithubCreditLink({ children }: { children?: ReactNode }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      className="art-footer__credit-link"
    >
      <img
        src={githubSvg}
        alt=""
        aria-hidden="true"
        className="art-footer__github-icon art-footer__github-icon--inline"
      />
      {children}
    </a>
  )
}

/**
 * Simple paper footer: a quiet theme-aware paper band with a subtle grain and
 * the legal pill buttons. The GitHub link lives with the open-source credit,
 * plus a status pill when the deployment configured one.
 */
export function ArtFooter({ hiddenOnMobile }: { hiddenOnMobile: boolean }) {
  const { t } = useTranslation()
  const statusPageUrl = getStatusPageUrl()

  return (
    <footer
      data-testid="art-footer"
      className={`${hiddenOnMobile ? 'hidden sm:block' : 'block'} art-footer relative z-10 mt-8 sm:mt-16 md:mt-24`}
    >
      <div className="art-footer__body">
        <span className="art-footer__grain" aria-hidden="true" />
        <div className="art-footer__row">
          <nav
            aria-label={t('Footer.legalNavigation')}
            className="art-footer__links"
          >
            <Link to="/privacy" className="art-footer__link">
              {t('Footer.privacy')}
            </Link>
            <Link to="/terms" className="art-footer__link">
              {t('Footer.terms')}
            </Link>
            <Link to="/imprint" className="art-footer__link">
              {t('Footer.imprint')}
            </Link>
            <Link to="/feedback" className="art-footer__link">
              {t('Feedback.navigationLabel')}
            </Link>
            {statusPageUrl ? (
              <a
                className="art-footer__link"
                href={statusPageUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('Footer.status')}
              </a>
            ) : null}
          </nav>
          <p className="art-footer__credit">
            <span className="whitespace-nowrap">
              <Trans
                i18nKey="Footer.madeIn"
                components={{ github: <GithubCreditLink /> }}
              />
            </span>
            <Link
              to="/sponsor"
              className="art-footer__link art-footer__link--warm"
            >
              {t('Footer.sponsor')}
            </Link>
          </p>
        </div>
      </div>
    </footer>
  )
}

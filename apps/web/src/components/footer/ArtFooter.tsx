import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import githubSvg from '../auth/github.svg'

import './footer-art.css'

/**
 * Simple paper footer: a quiet theme-aware paper band with a subtle grain and
 * the legal/GitHub pill buttons. No artwork, no brand mark, no credit.
 */
export function ArtFooter({ hiddenOnMobile }: { hiddenOnMobile: boolean }) {
  const { t } = useTranslation()

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
            <a
              className="art-footer__link"
              href="https://github.com/antonio-ivanovski/spliit-cloud"
            >
              <img src={githubSvg} alt="" className="art-footer__github-icon" />
              GitHub
            </a>
          </nav>
          <p className="art-footer__credit">
            <span>{t('Footer.madeIn')}</span>
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

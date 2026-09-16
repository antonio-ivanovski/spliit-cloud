/* oxlint-disable jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans injects the email link's accessible text at runtime. */
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Bitcoin,
  ExternalLink,
  HeartHandshake,
  Mail,
  Wallet,
  Zap,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Trans, useTranslation } from 'react-i18next'

import {
  CopyButton,
  SupportNotice,
  SupportOptionCard,
  SupportPageHeader,
  SupportPageShell,
  useCopyToClipboard,
} from '@/components/support'

const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/antonio-ivanovski'

/** Donations always go to the upstream project, on every instance. */
const EVM_ADDRESS = '0x3B1490F2dAF01FF3BdeE1868087f189AEa027bFf'
const BTC_ADDRESS =
  'bc1qhkf4snvtzj0723tj2g8ryfmyhntdvy7fu66mzx6wwafl83u94njqnq2jtw'
const LIGHTNING_ADDRESS = 'purplecoil09@walletofsatoshi.com'
const CONTACT_EMAIL = 'contact@spliit.cloud'

const linkClassName = 'font-medium text-primary underline underline-offset-2'

function AddressBlock({
  address,
  qrValue,
  qrLabel,
  addressLabel,
  copyLabel,
  copiedLabel,
  copyFailedMessage,
}: {
  address: string
  qrValue: string
  qrLabel: string
  addressLabel: string
  copyLabel: string
  copiedLabel: string
  copyFailedMessage: string
}) {
  const { copyState, copy } = useCopyToClipboard()

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl bg-white p-3 shadow-xs">
        <QRCodeSVG value={qrValue} size={160} level="M" aria-label={qrLabel} />
      </div>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {addressLabel}
      </p>
      <code className="w-full rounded-lg border bg-background px-3 py-2.5 text-xs leading-5 break-all select-all sm:text-[13px]">
        {address}
      </code>
      <CopyButton
        copyState={copyState}
        copyLabel={copyLabel}
        copiedLabel={copiedLabel}
        onCopy={() => void copy(address)}
        className="w-full"
      />
      {copyState === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {copyFailedMessage}
        </p>
      )}
    </div>
  )
}

const cryptoMethods = [
  {
    key: 'evm',
    address: EVM_ADDRESS,
    qrValue: EVM_ADDRESS,
    icon: Wallet,
    accent:
      'border-sky-200/80 bg-sky-50/60 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/25 dark:text-sky-300',
  },
  {
    key: 'bitcoin',
    address: BTC_ADDRESS,
    qrValue: `bitcoin:${BTC_ADDRESS}`,
    icon: Bitcoin,
    accent:
      'border-orange-200/80 bg-orange-50/60 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/25 dark:text-orange-300',
  },
  {
    key: 'lightning',
    address: LIGHTNING_ADDRESS,
    qrValue: `lightning:${LIGHTNING_ADDRESS}`,
    icon: Zap,
    accent:
      'border-violet-200/80 bg-violet-50/60 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/25 dark:text-violet-300',
  },
] as const satisfies ReadonlyArray<{
  key: 'evm' | 'bitcoin' | 'lightning'
  address: string
  qrValue: string
  icon: LucideIcon
  accent: string
}>

export default function SponsorPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Sponsor' })

  return (
    <SupportPageShell>
      <SupportPageHeader icon={HeartHandshake} title={t('title')} />

      <div className="rounded-2xl bg-card px-5 py-5 text-center sm:px-8 sm:py-6">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">
            {t('description')}
          </p>
          <div
            className="mx-auto my-4 h-px max-w-xs bg-border"
            aria-hidden="true"
          />
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-primary" aria-hidden="true" />
            {t('contact.title')}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            <Trans
              i18nKey="Sponsor.contact.description"
              components={{
                email: (
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className={linkClassName}
                  />
                ),
              }}
            />
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            <Trans
              i18nKey="Sponsor.feedbackLink"
              components={{
                cta: <Link to="/feedback" className={linkClassName} />,
              }}
            />
          </p>
        </div>
      </div>

      <article className="group flex flex-col gap-5 rounded-2xl border border-primary/25 bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-rose-200/80 bg-rose-50/60 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300">
          <HeartHandshake className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('github.title')}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {t('github.description')}
          </p>
        </div>
        <a
          href={GITHUB_SPONSORS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-xl border bg-background px-3.5 text-sm font-medium transition-colors group-hover:border-primary/30 group-hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden sm:min-w-52"
        >
          {t('github.action')}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </article>

      <section
        aria-label={t('methodsLabel')}
        className="grid gap-4 lg:grid-cols-3"
      >
        {cryptoMethods.map(({ key, address, qrValue, icon: Icon, accent }) => (
          <SupportOptionCard
            key={key}
            icon={Icon}
            accent={accent}
            title={t(`${key}.title`)}
            eyebrow={t(`${key}.network`)}
            description={t(`${key}.description`)}
            extra={
              key === 'evm' ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  <Trans
                    i18nKey="Sponsor.evm.contact"
                    components={{
                      email: (
                        <a
                          href={`mailto:${CONTACT_EMAIL}`}
                          className={linkClassName}
                        />
                      ),
                    }}
                  />
                </p>
              ) : undefined
            }
            footer={
              <AddressBlock
                address={address}
                qrValue={qrValue}
                qrLabel={t(`${key}.qrLabel`)}
                addressLabel={t(`${key}.addressLabel`)}
                copyLabel={t(`${key}.copy`)}
                copiedLabel={t(`${key}.copied`)}
                copyFailedMessage={t(`${key}.copyFailed`)}
              />
            }
          />
        ))}
      </section>

      <SupportNotice
        icon={AlertTriangle}
        tone="amber"
        title={t('notice.title')}
      >
        <p>{t('notice.description')}</p>
      </SupportNotice>
    </SupportPageShell>
  )
}

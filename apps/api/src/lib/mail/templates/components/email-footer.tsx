import { Hr, Link, Section, Text } from '@react-email/components'

type EmailFooterProps = {
  unsubscribeUrl?: string
}

/**
 * Subtle footer at the bottom of every email. Spliit wordmark + the
 * default "you received this email because…" copy. Most transactional
 * emails include something here for inbox-trust reasons.
 */
export function EmailFooter({ unsubscribeUrl }: EmailFooterProps) {
  return (
    <Section className="mt-8">
      <Hr className="border-none border-t border-solid border-[#e5e7eb] my-4" />
      <Text className="m-0 text-[12px] leading-[18px] text-[#64748b]">
        Spliit Cloud · split expenses with friends and groups.
      </Text>
      {unsubscribeUrl ? (
        <Text className="m-0 mt-2 text-[12px] leading-[18px] text-[#64748b]">
          <Link href={unsubscribeUrl} className="text-[#64748b] underline">
            Unsubscribe from these email notifications
          </Link>
        </Text>
      ) : null}
    </Section>
  )
}

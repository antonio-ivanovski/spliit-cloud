import { Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'

type EmailInfoBlockProps = {
  children: ReactNode
}

/**
 * Bordered info card, used for snippets like "import source" context. Uses
 * table layout because most email clients ignore flex/grid.
 */
export function EmailInfoBlock({ children }: EmailInfoBlockProps) {
  return (
    <Section
      className="my-4 rounded-md border border-solid border-[#e5e7eb] bg-[#f8fafc] px-5 py-4"
      style={{ backgroundColor: '#f8fafc' }}
    >
      <Text className="m-0 text-[14px] leading-[20px] text-[#0f172a]">
        {children}
      </Text>
    </Section>
  )
}

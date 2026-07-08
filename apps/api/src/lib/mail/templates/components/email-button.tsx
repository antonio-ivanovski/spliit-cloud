import { Button } from '@react-email/components'

type EmailButtonProps = {
  href: string
  label: string
}

/**
 * Primary CTA button. Mirrors the green web-app primary colour.
 * `box-border` is required so the padding stays inside the button width
 * in Outlook (which renders buttons differently from other clients).
 */
export function EmailButton({ href, label }: EmailButtonProps) {
  return (
    <Button
      href={href}
      className="bg-[#04785b] text-white text-[15px] font-semibold no-underline text-center rounded-md px-6 py-3 box-border inline-block"
    >
      {label}
    </Button>
  )
}

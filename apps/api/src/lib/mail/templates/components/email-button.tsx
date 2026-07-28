import { Button } from '@react-email/components'

type EmailButtonProps = {
  href: string
  label: string
}

/**
 * Primary CTA button. Mirrors the green web-app primary colour. `box-border` is
 * required so the padding stays inside the button width in Outlook (which
 * renders buttons differently from other clients).
 */
export function EmailButton({ href, label }: EmailButtonProps) {
  return (
    <Button
      href={href}
      className="box-border inline-block rounded-md bg-[#04785b] px-6 py-3 text-center text-[15px] font-semibold text-white no-underline"
    >
      {label}
    </Button>
  )
}

import { replaceBrowserLocation } from '@/lib/browser-navigation'

/** Bootstrap the new cookie session at the sole setup/auth-return owner. */
export function completeAuthSignIn(input: {
  completeProfilePath: string
}): void {
  replaceBrowserLocation(input.completeProfilePath)
}

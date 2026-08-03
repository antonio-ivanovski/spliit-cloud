import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAccountPreferenceUpdater } from '@/components/account-preferences-sync'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ThemeToggle() {
  const { setTheme } = useTheme()
  const updater = useAccountPreferenceUpdater()
  const { t } = useTranslation(undefined, { keyPrefix: 'Theme' })
  const selectTheme = (theme: 'light' | 'dark' | 'system') => {
    if (updater) {
      setTheme(theme, { persist: false, notify: false })
      void updater.patchPreferences({ theme })
    } else {
      setTheme(theme)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-primary"
            disabled={updater !== null && !updater.ready}
          />
        }
      >
        <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 opacity-100 transition-[transform,opacity] dark:scale-95 dark:-rotate-90 dark:opacity-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-95 rotate-90 opacity-0 transition-[transform,opacity] dark:scale-100 dark:rotate-0 dark:opacity-100" />
        <span className="sr-only">{t('toggle')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => selectTheme('light')}>
          {t('light')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => selectTheme('dark')}>
          {t('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => selectTheme('system')}>
          {t('system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAccountPreferenceUpdater } from '@/components/account-preferences-sync'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { setTheme, halloweenInSeason, halloweenEnabled, setHalloweenEnabled } =
    useTheme()
  const updater = useAccountPreferenceUpdater()
  const { t } = useTranslation(undefined, { keyPrefix: 'Theme' })
  const accountThemeControlsDisabled = updater !== null && !updater.ready
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
            disabled={accountThemeControlsDisabled && !halloweenInSeason}
          />
        }
      >
        <Sun
          className={cn(
            'h-[1.2rem] w-[1.2rem] scale-100 rotate-0 opacity-100 transition-[transform,opacity] dark:scale-95 dark:-rotate-90 dark:opacity-0',
            halloweenEnabled && 'invisible',
          )}
        />
        <Moon
          className={cn(
            'absolute h-[1.2rem] w-[1.2rem] scale-95 rotate-90 opacity-0 transition-[transform,opacity] dark:scale-100 dark:rotate-0 dark:opacity-100',
            halloweenEnabled && 'invisible',
          )}
        />
        {halloweenEnabled ? (
          <span aria-hidden="true" className="absolute text-lg">
            🎃
          </span>
        ) : null}
        <span className="sr-only">{t('toggle')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={accountThemeControlsDisabled}
          onClick={() => selectTheme('light')}
        >
          {t('light')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={accountThemeControlsDisabled}
          onClick={() => selectTheme('dark')}
        >
          {t('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={accountThemeControlsDisabled}
          onClick={() => selectTheme('system')}
        >
          {t('system')}
        </DropdownMenuItem>
        {halloweenInSeason ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={halloweenEnabled}
              onCheckedChange={setHalloweenEnabled}
            >
              <span aria-hidden="true" className="me-2">
                🎃
              </span>
              {t('halloweenEffects')}
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

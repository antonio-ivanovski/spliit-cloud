import { useLocation, useNavigate } from '@tanstack/react-router'
import { Camera, Mic, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentGroupOrNull } from '@/app/groups/[groupId]/current-group-context'
import { CreateFromReceiptButton } from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import { VoiceExpenseButton } from '@/app/groups/[groupId]/expenses/voice-expense-button'
import { Button } from '@/components/ui/button'
import {
  SpeedDial,
  SpeedDialAction,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialTrigger,
} from '@/components/ui/speed-dial'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Props = {
  enableReceiptExtract: boolean
  enableVoiceExpense: boolean
}

/**
 * Shared expense actions. Desktop renders a compact contextual control; mobile
 * uses a labeled speed dial above the safe area and group navigation.
 */
export function CreateExpenseFab({
  enableReceiptExtract,
  enableVoiceExpense,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AIExpense' })
  const currentGroup = useCurrentGroupOrNull()
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const [speedDialOpen, setSpeedDialOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [voiceFlowActive, setVoiceFlowActive] = useState(false)
  const [receiptFlowActive, setReceiptFlowActive] = useState(false)
  const isExpenseFormRoute =
    pathname.endsWith('/expenses/create') ||
    /\/expenses\/[^/]+\/edit$/.test(pathname)
  const isBudgetsRoute = pathname.includes('/budgets')
  const canEditCurrentGroup = Boolean(
    currentGroup?.group &&
    !currentGroup.currentInvitation &&
    !currentGroup.group.archived,
  )
  const actionFlowActive =
    voiceOpen || receiptOpen || voiceFlowActive || receiptFlowActive

  if (isExpenseFormRoute || isBudgetsRoute || !canEditCurrentGroup) {
    return null
  }

  const closeSpeedDial = () => setSpeedDialOpen(false)
  const goToManualExpense = () => {
    closeSpeedDial()
    if (currentGroup?.group) {
      void navigate({
        to: '/groups/$groupId/expenses/create',
        params: { groupId: currentGroup.group.id },
      })
    }
  }
  const openReceipt = () => {
    closeSpeedDial()
    setReceiptOpen(true)
  }
  const openVoice = () => {
    closeSpeedDial()
    setVoiceOpen(true)
  }
  const hasAiActions = enableVoiceExpense || enableReceiptExtract

  return (
    <>
      {!actionFlowActive && (
        <div className="hidden items-center sm:flex">
          <TooltipProvider delay={300} closeDelay={100}>
            <div
              data-testid="expense-action-control"
              className="isolate inline-flex h-11 items-stretch rounded-lg border border-border/70 bg-background/90 shadow-xs"
            >
              <Button
                type="button"
                variant="default"
                className="h-10 gap-2 self-center rounded-s-md rounded-e-none px-3.5 shadow-none"
                onClick={goToManualExpense}
              >
                <Plus className="size-4" />
                {t('addExpenseAction')}
              </Button>
              {hasAiActions && (
                <div className="flex items-stretch border-s border-border/70">
                  {enableVoiceExpense && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'size-10 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground',
                              !enableReceiptExtract && 'rounded-e-md',
                            )}
                            onClick={openVoice}
                            aria-label={t('voiceAction')}
                          />
                        }
                      >
                        <Mic className="size-[18px]" />
                      </TooltipTrigger>
                      <TooltipContent>{t('voiceAction')}</TooltipContent>
                    </Tooltip>
                  )}
                  {enableReceiptExtract && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 rounded-s-none rounded-e-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={openReceipt}
                            aria-label={t('receiptAction')}
                          />
                        }
                      >
                        <Camera className="size-[18px]" />
                      </TooltipTrigger>
                      <TooltipContent>{t('receiptAction')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          </TooltipProvider>
        </div>
      )}

      {!actionFlowActive && (
        <SpeedDial
          open={speedDialOpen}
          onOpenChange={setSpeedDialOpen}
          className={cn(
            'fixed end-6 z-40 sm:hidden',
            'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          <SpeedDialContent>
            {enableReceiptExtract && (
              <SpeedDialItem>
                <SpeedDialLabel>{t('receiptAction')}</SpeedDialLabel>
                <SpeedDialAction
                  aria-label={t('receiptAction')}
                  onClick={openReceipt}
                  className="flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-transform hover:scale-105 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Camera className="size-5" />
                </SpeedDialAction>
              </SpeedDialItem>
            )}
            {enableVoiceExpense && (
              <SpeedDialItem>
                <SpeedDialLabel>{t('voiceAction')}</SpeedDialLabel>
                <SpeedDialAction
                  aria-label={t('voiceAction')}
                  onClick={openVoice}
                  className="flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-transform hover:scale-105 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Mic className="size-5" />
                </SpeedDialAction>
              </SpeedDialItem>
            )}
            <SpeedDialItem>
              <SpeedDialLabel>{t('addExpenseAction')}</SpeedDialLabel>
              <SpeedDialAction
                aria-label={t('addExpenseAction')}
                onClick={goToManualExpense}
                className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-5" />
              </SpeedDialAction>
            </SpeedDialItem>
          </SpeedDialContent>
          <SpeedDialTrigger
            aria-label={speedDialOpen ? t('closeActions') : t('openActions')}
            className={cn(
              'flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-200 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring',
              speedDialOpen && 'rotate-90',
            )}
          >
            {speedDialOpen ? (
              <X className="size-6" />
            ) : (
              <Plus className="size-6" />
            )}
          </SpeedDialTrigger>
        </SpeedDial>
      )}

      {enableVoiceExpense && (
        <VoiceExpenseButton
          hideTrigger
          open={voiceOpen}
          onOpenChange={setVoiceOpen}
          onFlowActiveChange={setVoiceFlowActive}
        />
      )}
      {enableReceiptExtract && (
        <CreateFromReceiptButton
          hideTrigger
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          onFlowActiveChange={setReceiptFlowActive}
        />
      )}
    </>
  )
}

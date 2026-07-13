import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { Check, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AllocationEntry } from '../allocation-engine'
import type { VisualSplitParticipant, VisualSplitRow } from './types'
import { formatUnit } from './visual-split-utils'

type VisualSplitParticipantRowProps = {
  participant: VisualSplitParticipant
  mode: SplitMode
  currency: Currency
  readOnly: boolean
  editable: boolean
  checked: boolean
  isOnlySelected: boolean
  value: number
  preview: React.ReactNode | null
  row?: VisualSplitRow
  entry?: AllocationEntry
  inputValue?: string
  inputError?: string
  pendingLabel?: string
  onToggle: (participantId: string, checked: boolean) => void
  onSetInputValue: (participantId: string, value: string) => void
  onCommitParticipantValue: (participantId: string) => void
  onClearInput: (participantId: string) => void
  onParticipantSharesChange: (participantId: string, nextShares: number) => void
}

export function VisualSplitParticipantRow({
  participant,
  mode,
  currency,
  readOnly,
  editable,
  checked,
  isOnlySelected,
  value,
  preview,
  row,
  entry,
  inputValue,
  inputError,
  pendingLabel,
  onToggle,
  onSetInputValue,
  onCommitParticipantValue,
  onClearInput,
  onParticipantSharesChange,
}: VisualSplitParticipantRowProps) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.VisualSplit',
  })
  const locale = useLocale()
  const sharesLabel = t('shares')
  const formatValue = (v: number) =>
    formatUnit(mode, v, currency, locale, sharesLabel)

  return (
    <div className="py-2.5">
      <div
        className={cn(
          'flex min-h-11 items-center gap-3',
          !readOnly && !isOnlySelected && 'cursor-pointer',
        )}
        onClick={(event) => {
          if (readOnly) return
          if (isOnlySelected) return
          const target = event.target as HTMLElement
          if (
            target.closest(
              'button, input, label, [role="button"], textarea, select',
            )
          )
            return
          onToggle(participant.id, !checked)
        }}
      >
        <Checkbox
          checked={checked}
          disabled={readOnly || isOnlySelected}
          onCheckedChange={(next) => onToggle(participant.id, next === true)}
          aria-label={participant.name}
        />
        <ParticipantAvatar participant={participant} size="sm" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {participant.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {participant.pending && pendingLabel ? `${pendingLabel} · ` : ''}
            {preview}
          </span>
        </div>
        {checked && mode === 'BY_SHARES' && (
          <div className="flex items-center rounded-full border bg-background p-0.5 shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 rounded-full"
              disabled={readOnly || Number(row?.shares) <= 1}
              aria-label={t('decreaseShares', { name: participant.name })}
              onClick={() =>
                onParticipantSharesChange(
                  participant.id,
                  Math.max(1, Math.round(Number(row?.shares ?? 1)) - 1),
                )
              }
            >
              <Minus className="size-4" />
            </Button>
            <Input
              className="h-9 w-12 border-0 bg-transparent px-1 text-center font-semibold tabular-nums shadow-none focus-visible:ring-0"
              type="number"
              min={1}
              step={1}
              disabled={readOnly}
              value={Math.max(1, Math.round(Number(row?.shares ?? 1)))}
              aria-label={`${participant.name} ${t('shares')}`}
              onChange={(event) =>
                onParticipantSharesChange(
                  participant.id,
                  Math.max(1, Math.round(Number(event.target.value) || 1)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 rounded-full"
              disabled={readOnly}
              aria-label={t('increaseShares', { name: participant.name })}
              onClick={() =>
                onParticipantSharesChange(
                  participant.id,
                  Math.round(Number(row?.shares ?? 1)) + 1,
                )
              }
            >
              <Plus className="size-4" />
            </Button>
          </div>
        )}
        {checked && mode === 'EVENLY' && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {preview}
          </span>
        )}
        {checked && editable && mode !== 'BY_SHARES' && entry && (
          <div className="flex items-center gap-1">
            <Input
              className="h-9 w-28 text-right tabular-nums"
              inputMode="decimal"
              value={inputValue ?? formatValue(value).replace(/[^0-9.,-]/g, '')}
              disabled={readOnly}
              aria-label={t('setValue', {
                name: participant.name,
                kind: t(mode === 'BY_PERCENTAGE' ? 'percentage' : 'amount'),
              })}
              aria-invalid={!!inputError}
              onChange={(event) =>
                onSetInputValue(participant.id, event.target.value)
              }
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onCommitParticipantValue(participant.id)
                }
                if (event.key === 'Escape') {
                  onClearInput(participant.id)
                }
              }}
              onBlur={() => onCommitParticipantValue(participant.id)}
            />
            <span className="text-xs text-muted-foreground">
              {mode === 'BY_PERCENTAGE' ? '%' : currency.symbol}
            </span>
            <Check
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
      </div>
      {inputError && (
        <p className="ml-[5.5rem] mt-1 text-right text-xs text-destructive">
          {inputError}
        </p>
      )}
    </div>
  )
}

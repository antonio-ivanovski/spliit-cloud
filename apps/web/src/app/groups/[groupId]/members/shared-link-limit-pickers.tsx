import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  SHARED_LINK_CUSTOM_PRESET,
  SHARED_LINK_DEFAULT_EXPIRY,
  SHARED_LINK_EXPIRY_PRESETS,
  SHARED_LINK_JOIN_PRESETS,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MIN_USES,
  type SharedLinkExpiry,
  type SharedLinkExpiryUnit,
} from './members-hooks'

const EXPIRY_UNITS: SharedLinkExpiryUnit[] = ['hours', 'days', 'weeks']

function expiryUnitLabel(
  unit: SharedLinkExpiryUnit,
  t: (key: string) => string,
): string {
  return t(
    `invite.link.expiryUnit${unit === 'hours' ? 'Hour' : unit === 'days' ? 'Day' : 'Week'}`,
  )
}

/**
 * Join-limit picker for shared links: Unlimited (default) plus capped presets,
 * with an "Other" custom input for the rest of the 2–1000 range.
 *
 * Fully controlled: `preset` selects the option, `value` (null = unlimited)
 * carries the cap. Both live in the parent form so submit validation can tell
 * "Other left empty" (error) apart from "Unlimited" (valid).
 */
export function JoinLimitPicker({
  preset,
  onPresetChange,
  value,
  onChange,
  disabled,
  label,
}: {
  preset: string
  onPresetChange: (preset: string) => void
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  label: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  function handlePresetChange(next: string | null) {
    if (next == null) return
    onPresetChange(next)
    if (next === 'unlimited') {
      onChange(null)
    } else if (next !== SHARED_LINK_CUSTOM_PRESET) {
      onChange(Number(next))
    }
    // Switching to Other keeps the current cap so a preset value stays
    // visible (and valid) in the custom input; clearing it empties to null.
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Select
        value={preset}
        onValueChange={handlePresetChange}
        disabled={disabled}
        items={[
          { value: 'unlimited', label: t('invite.link.unlimitedJoins') },
          ...SHARED_LINK_JOIN_PRESETS.map((count) => ({
            value: String(count),
            label: `${count} ${t('invite.link.joinsSuffix')}`,
          })),
          {
            value: SHARED_LINK_CUSTOM_PRESET,
            label: t('invite.link.otherOption'),
          },
        ]}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unlimited">
            {t('invite.link.unlimitedJoins')}
          </SelectItem>
          {SHARED_LINK_JOIN_PRESETS.map((count) => (
            <SelectItem key={count} value={String(count)}>
              {count} {t('invite.link.joinsSuffix')}
            </SelectItem>
          ))}
          <SelectItem value={SHARED_LINK_CUSTOM_PRESET}>
            {t('invite.link.otherOption')}
          </SelectItem>
        </SelectContent>
      </Select>
      {preset === SHARED_LINK_CUSTOM_PRESET && (
        // Suffix lives inside the input border (AmountInput pattern), not
        // beside it: the row stays one control wide on narrow dialogs.
        <div className="relative w-full">
          <Input
            className={cn('pe-16 text-base tabular-nums')}
            type="number"
            inputMode="numeric"
            min={SHARED_LINK_MIN_USES}
            max={SHARED_LINK_MAX_USES_LIMIT}
            disabled={disabled}
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              onChange(raw === '' ? null : Number(raw))
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
          >
            {t('invite.link.joinsSuffix')}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Expiry picker for shared links: durations from creation/save time plus
 * never-expires, with an "Other" custom amount/unit input.
 *
 * The manage dialog passes `keepOption` to offer the current expiry untouched
 * (value `undefined` = no change on submit); the create form omits it and the
 * value itself decides (`null` = never expires).
 */
export function ExpiryPicker({
  preset,
  onPresetChange,
  value,
  onChange,
  disabled,
  label,
  keepOption,
}: {
  preset: string
  onPresetChange: (preset: string) => void
  value: SharedLinkExpiry | undefined
  onChange: (value: SharedLinkExpiry | undefined) => void
  disabled?: boolean
  label: string
  keepOption?: { label: string }
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  // The unit select needs a concrete unit even when the amount was cleared
  // (null) — fall back to the 7-day default shape, never to a preset.
  const customValue = value ?? { ...SHARED_LINK_DEFAULT_EXPIRY }

  function handlePresetChange(next: string | null) {
    if (next == null) return
    onPresetChange(next)
    if (next === 'keep') {
      onChange(undefined)
    } else if (next === SHARED_LINK_CUSTOM_PRESET) {
      // Start the custom input from the current duration when it is already
      // custom; otherwise seed it with the 7-day default.
      if (value === undefined || value === null || isPresetDuration(value)) {
        onChange({ ...SHARED_LINK_DEFAULT_EXPIRY })
      }
    } else if (next === 'never') {
      onChange(null)
    } else {
      const match = SHARED_LINK_EXPIRY_PRESETS.find(
        (option) => option.key === next,
      )
      if (match) onChange({ amount: match.amount, unit: match.unit })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Select
        value={preset}
        onValueChange={handlePresetChange}
        disabled={disabled}
        items={[
          ...(keepOption
            ? [{ value: 'keep' as const, label: keepOption.label }]
            : []),
          ...SHARED_LINK_EXPIRY_PRESETS.map((option) => ({
            value: option.key,
            label: t(`invite.link.${option.key}`),
          })),
          { value: 'never' as const, label: t('invite.link.neverExpires') },
          {
            value: SHARED_LINK_CUSTOM_PRESET,
            label: t('invite.link.otherOption'),
          },
        ]}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {keepOption && (
            <SelectItem value="keep">{keepOption.label}</SelectItem>
          )}
          {SHARED_LINK_EXPIRY_PRESETS.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {t(`invite.link.${option.key}`)}
            </SelectItem>
          ))}
          <SelectItem value="never">{t('invite.link.neverExpires')}</SelectItem>
          <SelectItem value={SHARED_LINK_CUSTOM_PRESET}>
            {t('invite.link.otherOption')}
          </SelectItem>
        </SelectContent>
      </Select>
      {preset === SHARED_LINK_CUSTOM_PRESET && (
        // Composite input (amount + unit in one border, expense-amount
        // pattern): stays one control wide; unit never wraps below.
        <div className="flex w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <Input
            className="h-11 min-w-0 flex-1 rounded-none border-0 text-base tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-10"
            type="number"
            inputMode="numeric"
            min={1}
            disabled={disabled}
            aria-label={label}
            value={value === null || value === undefined ? '' : value.amount}
            onChange={(event) => {
              const raw = event.target.value
              onChange(
                raw === ''
                  ? null
                  : { amount: Number(raw), unit: customValue.unit },
              )
            }}
          />
          <Select
            value={customValue.unit}
            onValueChange={(unit) =>
              onChange({
                amount: customValue.amount ?? SHARED_LINK_DEFAULT_EXPIRY.amount,
                unit: unit as SharedLinkExpiryUnit,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger
              aria-label={t('invite.link.expiryUnitLabel')}
              className="h-11 w-28 shrink-0 gap-1 rounded-none border-0 border-s border-input px-3 sm:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_UNITS.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {expiryUnitLabel(unit, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

/** Whether a duration exactly matches one of the expiry presets. */
function isPresetDuration(value: SharedLinkExpiry): boolean {
  if (value == null) return false
  return SHARED_LINK_EXPIRY_PRESETS.some(
    (option) => option.amount === value.amount && option.unit === value.unit,
  )
}

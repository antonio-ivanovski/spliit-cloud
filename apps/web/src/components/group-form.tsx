import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Save, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { GroupAppearanceField } from '@/components/group-appearance-field'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { AccountPreferences } from '@/lib/account-preferences'
import type { getGroup } from '@/lib/api'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { resolveGroupColor } from '@/lib/group-appearance'
import { usePwaUpdateBlocker } from '@/lib/pwa-update-blockers'
import type { GroupFormValues } from '@/lib/schemas'
import { groupFormSchema } from '@/lib/schemas'
import { extractSingleTitleEmoji, isEmojiUndecided } from '@spliit/domain'

import { CurrencySelector } from './currency-selector'
import { Textarea } from './ui/textarea'

export type Props = {
  group?: NonNullable<Awaited<ReturnType<typeof getGroup>>>
  /**
   * Current caller's role on the group (when editing an existing group). When
   * set to `MEMBER`, the form renders in a read-only state: the input controls
   * are disabled, no Save button is shown, and a small note explains the
   * restriction. Inviting members is done from the Members tab; this form no
   * longer collects pending invitations.
   */
  currentMemberRole?: 'ADMIN' | 'MEMBER'
  /**
   * Explicit group-wide access mode. Unlike `currentMemberRole`, this also
   * covers pending invitations, public links, and a future view-only member.
   */
  readOnly?: boolean
  /**
   * When `true`, the group is archived and its settings are frozen. All inputs
   * are disabled and no Save button is shown. Archived groups are not editable
   * from this form even for ADMIN — unarchive the group first.
   */
  archived?: boolean
  /**
   * When `true`, hide the "After the group is created, open the Members tab to
   * invite people" hint. The import wizard renders this form inline and
   * surfaces invites on its own Done step, so the hint would be misleading
   * there.
   */
  hideInviteHint?: boolean
  /**
   * When provided, applied to the `<form>` element's `id` so external buttons
   * (e.g. a wizard-shell Continue) can submit the form via the native HTML
   * `form` attribute without being nested inside it.
   */
  formId?: string
  /**
   * Hide the in-form Save / Cancel actions so a parent (e.g. the import wizard)
   * can render its own Continue button at the shell level. The form is still
   * validatable and submit-on-Enter still works.
   */
  hideActions?: boolean
  /**
   * When `true`, the name input is hidden entirely. Used for FRIEND-typed
   * ledgers, where the name is fixed by the system and should not be shown in
   * the settings form.
   */
  hideNameField?: boolean
  /**
   * When `true`, the name input is rendered as disabled (read-only) so the
   * field cannot be edited.
   */
  nameReadOnly?: boolean
  /**
   * When `true`, the group already contains expenses and the currency selector
   * is disabled with a small note. The backend rejects any currency change
   * after expenses exist; this surfaces that on the UI.
   */
  currencyLocked?: boolean
  /**
   * Optional initial values for a brand-new group. Only used when `group` is
   * unset — the import wizard pre-fills the name, currency, and a default
   * "imported from Spliit" note so the user can hit Create without re-typing.
   * Edits to the form still flow through normally.
   */
  initialValues?: {
    name?: string
    information?: string
    currency?: string
    currencyCode?: string
    // Appearance prefill (e.g. restored from a cloud export bundle).
    // Omitted/undefined stays undecided (blank unless a title emoji is
    // extracted live/at mount); null/'' means explicitly none.
    emoji?: string | null
    color?: string | null
  }
  /**
   * When `true`, the emoji/color picker is hidden entirely. Used for
   * FRIEND-typed ledgers, whose identity is the peer's avatar.
   */
  hideAppearance?: boolean
  onSubmit: (groupFormValues: GroupFormValues) => Promise<void>
}

/**
 * Cloud groups are account-backed. The current account becomes the group ADMIN
 * on create, and additional members join through invitations.
 *
 * The `groupFormSchema` still requires a non-empty `participants` array, but
 * the backend ignores it on create/edit; we satisfy the schema with a stable
 * placeholder so the form always validates, even when the current account has
 * no display name yet (which previously made the create button silently do
 * nothing).
 */
const PARTICIPANTS_PLACEHOLDER = [{ name: 'Owner' }]
type GroupFormInput = z.input<typeof groupFormSchema>

export function GroupForm({
  group,
  currentMemberRole,
  readOnly: explicitReadOnly,
  archived = false,
  hideInviteHint = false,
  initialValues,
  formId,
  hideActions = false,
  hideNameField = false,
  hideAppearance = false,
  nameReadOnly = false,
  currencyLocked = false,
  onSubmit,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const readOnly =
    !!group && (explicitReadOnly ?? currentMemberRole === 'MEMBER')
  const isArchived = !!group && archived
  const accountPreferences =
    useSyncedAccountPreferences() as AccountPreferences | null
  const deploymentCurrencyCode = useDeploymentConfig().defaultCurrencyCode
  const initialCurrencyCode =
    initialValues?.currencyCode ??
    accountPreferences?.defaultCurrencyCode ??
    deploymentCurrencyCode

  // Existing groups created before the appearance feature keep their emoji
  // inside the name. When the emoji is still undecided, prefill the detected
  // title emoji into the group emoji (the form fields show exactly what will
  // be stored). Single-emoji only — deliberate multi-emoji decoration stays
  // in the name, exactly like live typing. Mount must not open the form
  // invalid, so a one-character remainder stays untouched here (live typing
  // still strips it and fails validation instead).
  const initialEmojiSuggestion = (() => {
    if (!group || !isEmojiUndecided(group.emoji)) return null
    // Hidden name or picker means the user cannot see or fix the stripped
    // value; never rewrite fields the form does not show.
    if (hideNameField || hideAppearance) return null
    const extracted = extractSingleTitleEmoji(group.name)
    if (!extracted || extracted.strippedName.length < 2) return null
    return extracted
  })()

  const form = useForm<GroupFormInput, unknown, GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: group
      ? {
          name: initialEmojiSuggestion?.strippedName ?? group.name,
          information: group.information ?? '',
          currency: group.currency ?? '',
          currencyCode: group.currencyCode ?? '',
          emoji: group.emoji ?? initialEmojiSuggestion?.emoji,
          color: resolveGroupColor(group.color),
          // The backend ignores `participants` on update; the form's
          // hidden `groupFormSchema.participants` validation only needs a
          // stable placeholder. The group.participants array mixes in
          // synthetic rows for pending invitations (with the invitee
          // email as the name), which can exceed the schema's 50-char
          // limit and break owner/admin saves with no visible field to
          // fix.
          participants: PARTICIPANTS_PLACEHOLDER,
        }
      : (() => {
          // Import prefills (e.g. a legacy export whose name still carries an
          // emoji) extract once at mount when the emoji is undecided, so the
          // fields visibly show the outcome instead of the server rewriting
          // it at submit. Silent: no undo notice for values the user didn't
          // type — the tiles stay editable.
          const prefillName = initialValues?.name ?? ''
          const prefillEmoji = initialValues?.emoji ?? undefined
          const extracted =
            isEmojiUndecided(prefillEmoji) && !hideAppearance
              ? extractSingleTitleEmoji(prefillName)
              : null
          // Same min-2 guard as the edit-form suggestion: a one-character
          // remainder must not prefill the form invalid.
          const mounted =
            extracted && extracted.strippedName.length >= 2 ? extracted : null
          return {
            name: mounted?.strippedName ?? prefillName,
            information: initialValues?.information ?? '',
            currency:
              initialValues?.currency ??
              getCurrency(initialCurrencyCode || 'USD')?.symbol ??
              '',
            currencyCode: initialCurrencyCode,
            // Blank unless prefilled (e.g. cloud-export restore) or picked.
            // The form schema has no null emoji lane, so a null prefill
            // (undecided export) maps to undefined; explicit '' is kept.
            emoji: mounted?.emoji ?? prefillEmoji,
            color: initialValues?.color,
            participants: PARTICIPANTS_PLACEHOLDER,
          }
        })(),
  })

  useEffect(() => {
    if (group || !accountPreferences) return
    const currencyCodeState = form.getFieldState('currencyCode')
    const currencyState = form.getFieldState('currency')
    const currencyWasEdited =
      currencyCodeState.isDirty ||
      currencyCodeState.isTouched ||
      currencyState.isDirty ||
      currencyState.isTouched
    if (
      initialValues?.currencyCode === undefined &&
      accountPreferences.defaultCurrencyCode &&
      !currencyWasEdited
    ) {
      const code = accountPreferences.defaultCurrencyCode
      form.setValue('currencyCode', code)
      form.setValue('currency', getCurrency(code)?.symbol ?? '')
    }
  }, [accountPreferences, form, group, initialValues])

  const { isDirty: isGroupFormDirty } = useFormState({ control: form.control })
  // Read-only / archived forms render no editable state, so never block.
  usePwaUpdateBlocker(
    isGroupFormDirty && !readOnly && !isArchived,
    'group-form-edits',
  )

  const watchedEmoji = form.watch('emoji')
  const watchedColor = form.watch('color')
  // A title emoji typed or pasted into the name field moves into the emoji
  // field immediately — the emoji never commits to the name input. The move
  // only fires while the emoji is undecided, so an explicit pick (or an
  // explicit None) always wins.
  const [movedNotice, setMovedNotice] = useState<{
    emoji: string
    nameBefore: string
    nameAfter: string
  } | null>(null)
  // Set when a move empties the name field: the separator typed right after
  // (e.g. the space in "🏝️ Weekend Trip" typed char by char) is consumed so
  // it doesn't accumulate as a leading space. Cleared at the first
  // non-whitespace input, on Undo, or whenever the field is non-empty for
  // another reason.
  const consumeSeparatorAfterEmptyMove = useRef(false)
  // The emoji moved out of the name while the field was empty. Lets a
  // variation selector or skin-tone modifier delivered as its own keystroke
  // (some IMEs and test drivers split "🏝️" into "🏝" + U+FE0F) attach to that
  // emoji instead of landing invisibly in the name.
  const lastMovedEmoji = useRef<string | null>(null)
  // Set by Undo: the restored name still contains exactly one emoji, so the
  // live rule would immediately move it again on the next keystroke. Suppress
  // that emoji until the name changes to no emoji or a different one.
  const suppressedEmoji = useRef<string | null>(null)
  // The notice survives continued name typing (the emoji-first flow: type
  // 🏝️, keep typing the name) so the transfer stays visible with its Undo;
  // it clears once the emoji itself changes again. Undo restores the
  // pre-move name only while the name is still untouched since the move —
  // otherwise it keeps the typed text and just unpicks the emoji, never
  // clobbering user input.
  useEffect(() => {
    if (movedNotice && watchedEmoji !== movedNotice.emoji) {
      setMovedNotice(null)
    }
  }, [movedNotice, watchedEmoji])

  function undoTitleEmojiMove() {
    if (!movedNotice) return
    if (form.getValues('emoji') !== movedNotice.emoji) {
      setMovedNotice(null)
      return
    }
    if ((form.getValues('name') ?? '') === movedNotice.nameAfter) {
      form.setValue('name', movedNotice.nameBefore, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })
    }
    // Back to undecided. The form schema has no null emoji lane (undecided is
    // undefined at this layer; null only exists at the API/DB layer), and the
    // update mutation leaves the stored value untouched on undefined — which
    // is correct here because the move only ever fires while undecided.
    form.setValue('emoji', undefined, {
      shouldDirty: true,
      shouldTouch: true,
    })
    consumeSeparatorAfterEmptyMove.current = false
    lastMovedEmoji.current = null
    suppressedEmoji.current = movedNotice.emoji
    setMovedNotice(null)
  }

  function maybeMoveTitleEmoji(next: string, input: HTMLInputElement | null) {
    if (readOnly || isArchived || nameReadOnly || hideAppearance) return next
    const extracted = extractSingleTitleEmoji(next)
    if (!extracted) {
      suppressedEmoji.current = null
      return next
    }
    if (extracted.emoji === suppressedEmoji.current) return next
    if (!isEmojiUndecided(form.getValues('emoji'))) return next
    // The pre-move name is the incoming value, not the stored one: RHF still
    // holds the previous keystroke here because we intercept before onChange.
    const nameBefore = next
    form.setValue('emoji', extracted.emoji, {
      shouldDirty: true,
      shouldTouch: true,
    })
    setMovedNotice({
      emoji: extracted.emoji,
      nameBefore,
      nameAfter: extracted.strippedName,
    })
    if (extracted.strippedName === '') {
      consumeSeparatorAfterEmptyMove.current = true
      lastMovedEmoji.current = extracted.emoji
    }
    // Keep the caret stable when the emoji was stripped before it; trailing
    // input (the common case) is already at the end. Skipped when the move
    // emptied the field — position 0 is the only valid caret there.
    if (
      input &&
      extracted.strippedName.length > 0 &&
      document.activeElement === input
    ) {
      const cursor = input.selectionStart ?? next.length
      const emojiIndex = next.indexOf(extracted.emoji)
      const newCursor =
        emojiIndex !== -1 && cursor > emojiIndex
          ? Math.max(
              emojiIndex,
              cursor - (next.length - extracted.strippedName.length),
            )
          : cursor
      requestAnimationFrame(() => {
        if (document.activeElement === input) {
          input.setSelectionRange(newCursor, newCursor)
        }
      })
    }
    return extracted.strippedName
  }

  // Live-move feedback renders under the name field, where the change
  // happened — not at the bottom of the appearance block. The appearance
  // block keeps only the mount-time suggestion hint, plus the move notice
  // as a fallback when the name field is hidden (the move itself is
  // blocked while the name is hidden, so that path is defensive only).
  const movedNameNotice = movedNotice ? (
    <span>
      {t('Appearance.autoMovedHint', { emoji: movedNotice.emoji })}{' '}
      <button
        type="button"
        onClick={undoTitleEmojiMove}
        className="underline underline-offset-2"
      >
        {t('Appearance.undoMove')}
      </button>
    </span>
  ) : null
  const suggestionHint =
    initialEmojiSuggestion &&
    watchedEmoji === initialEmojiSuggestion.emoji &&
    !movedNotice
      ? t('Appearance.detectedEmojiHint', {
          emoji: initialEmojiSuggestion.emoji,
        })
      : null
  const appearanceHint = hideNameField
    ? (movedNameNotice ?? suggestionHint)
    : suggestionHint

  const currencies = useCurrencies(
    t('CurrencyCodeField.customOption'),
    form.watch('currency') || undefined,
  )

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(async (values) => {
          if (readOnly || isArchived) return
          await onSubmit(values)
        })}
      >
        {isArchived && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t('archivedNotice')}
          </p>
        )}
        {readOnly && !isArchived && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t('readOnlyNote')}
          </p>
        )}

        <Card className="mb-2">
          <CardHeader className="hidden sm:flex">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 grid-cols-1 gap-4 pt-4 sm:grid-cols-2 sm:p-6 sm:pt-0">
            {!hideNameField && (
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-1 min-w-0">
                    <FormLabel>{t('NameField.label')}</FormLabel>
                    <FormDescription>
                      {t('NameField.description')}
                    </FormDescription>
                    <FormControl>
                      <Input
                        className="text-base"
                        placeholder={t('NameField.placeholder')}
                        disabled={readOnly || isArchived || nameReadOnly}
                        {...field}
                        onChange={(event) => {
                          // Leave IME composition alone; intercept after it
                          // commits so CJK input is never disturbed.
                          if (
                            event.nativeEvent instanceof InputEvent &&
                            event.nativeEvent.isComposing
                          ) {
                            field.onChange(event)
                            return
                          }
                          let next = event.target.value
                          // After a move emptied the field, swallow the
                          // separator and any variation selector/modifier
                          // delivered as its own keystroke (the "🏝️ Weekend
                          // Trip" char-by-char case) until real text arrives.
                          if (consumeSeparatorAfterEmptyMove.current) {
                            const modifier = next.match(
                              /^(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})+/u,
                            )?.[0]
                            if (modifier && lastMovedEmoji.current) {
                              const merged = lastMovedEmoji.current + modifier
                              lastMovedEmoji.current = merged
                              form.setValue('emoji', merged, {
                                shouldDirty: true,
                                shouldTouch: true,
                              })
                              setMovedNotice((notice) =>
                                notice ? { ...notice, emoji: merged } : notice,
                              )
                              next = next.slice(modifier.length)
                            }
                            next = next.replace(/^\s+/, '')
                            if (/\S/.test(next)) {
                              consumeSeparatorAfterEmptyMove.current = false
                              lastMovedEmoji.current = null
                            }
                          }
                          const committed = maybeMoveTitleEmoji(
                            next,
                            event.target,
                          )
                          if (committed === event.target.value) {
                            field.onChange(event)
                          } else {
                            // No shouldValidate: a move that empties (or
                            // shortens) the name must not flash an error
                            // before submit; submit validation still blocks.
                            form.setValue('name', committed, {
                              shouldDirty: true,
                              shouldTouch: true,
                            })
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                    {movedNameNotice ? (
                      <p className="text-xs text-muted-foreground">
                        {movedNameNotice}
                      </p>
                    ) : null}
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem className="col-span-1 min-w-0">
                  <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                  <FormDescription>
                    {currencyLocked
                      ? t('CurrencyCodeField.lockedAfterExpenses')
                      : t(
                          group
                            ? 'CurrencyCodeField.editDescription'
                            : 'CurrencyCodeField.createDescription',
                        )}
                  </FormDescription>
                  <CurrencySelector
                    aria-label={t('CurrencyCodeField.label')}
                    currencies={currencies}
                    // oxlint-disable-next-line react/incompatible-library -- react-hook-form watch reads during render by design.
                    defaultValue={form.watch(field.name) ?? ''}
                    pinnedCurrencyCode={form.watch(field.name) ?? undefined}
                    disabled={readOnly || isArchived || currencyLocked}
                    onValueChange={(newCurrency) => {
                      field.onChange(newCurrency)
                      const currency =
                        getCurrency(newCurrency) ??
                        ({
                          code: '',
                          symbol: '',
                          rounding: 0,
                          decimal_digits: 2,
                        } as const)
                      if (
                        currency.code.length ||
                        form.getFieldState('currency').isTouched
                      )
                        form.setValue('currency', currency.symbol, {
                          shouldValidate: true,
                          shouldTouch: true,
                          shouldDirty: true,
                        })
                    }}
                    isLoading={false}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem
                  hidden={!!form.watch('currencyCode')?.length}
                  className="col-span-1 min-w-0"
                >
                  <FormLabel>{t('CurrencyField.label')}</FormLabel>
                  <FormDescription>
                    {t('CurrencyField.description')}
                  </FormDescription>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('CurrencyField.placeholder')}
                      max={5}
                      disabled={readOnly || isArchived}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!hideAppearance && (
              <div className="col-span-1 min-w-0 sm:col-span-2">
                <FormField
                  control={form.control}
                  name="emoji"
                  render={({ field }) => (
                    <FormItem>
                      <GroupAppearanceField
                        emoji={field.value}
                        color={watchedColor}
                        disabled={readOnly || isArchived}
                        hint={appearanceHint}
                        onEmojiChange={(nextEmoji) => {
                          suppressedEmoji.current = null
                          field.onChange(nextEmoji)
                        }}
                        onColorChange={(next) =>
                          form.setValue('color', next, { shouldDirty: true })
                        }
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="col-span-1 min-w-0 sm:col-span-2">
              <FormField
                control={form.control}
                name="information"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('InformationField.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-base"
                        disabled={readOnly || isArchived}
                        {...field}
                        placeholder={t('InformationField.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>

          {!hideActions && !readOnly && !isArchived && (
            <CardContent className="flex flex-col gap-3 pt-4 sm:p-6 sm:pt-0">
              <div className="flex gap-2">
                <SubmitButton
                  className="flex-1 sm:flex-none"
                  loadingContent={t(
                    group ? 'Settings.saving' : 'Settings.creating',
                  )}
                >
                  <Save className="me-2 h-4 w-4" />{' '}
                  {t(group ? 'Settings.save' : 'Settings.create')}
                </SubmitButton>
                {!group && (
                  <Button
                    variant="ghost"
                    className="hidden sm:inline-flex"
                    nativeButton={false}
                    render={<Link to="/" />}
                  >
                    {t('Settings.cancel')}
                  </Button>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {!group && !hideInviteHint && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('Settings.inviteAfterCreate')}</span>
          </p>
        )}
      </form>
    </Form>
  )
}

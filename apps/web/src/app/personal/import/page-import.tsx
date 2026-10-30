import { Link } from '@tanstack/react-router'
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  applyCategoryBindingAssignment,
  preferredDateOrder,
} from '@/app/groups/[groupId]/expenses/csv-import-review-model'
import {
  inferExpenseFile,
  mapExpenseFile,
  parseExpenseFile,
  previewExpenseFile,
} from '@/app/groups/[groupId]/expenses/csv-import-worker-client'
import { CategorySelector } from '@/components/category-selector'
import { useDocumentTitle } from '@/components/document-title'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { formatCurrency } from '@/lib/utils'
import { DEFAULT_CATEGORIES, type CategoryId } from '@spliit/domain'
import type {
  DelimitedEncoding,
  DelimitedExpenseMappingV1,
  DelimitedTable,
} from '@spliit/domain/import'

import {
  useCommitPersonalImport,
  usePersonalProfile,
  usePreviewPersonalImport,
  type PersonalImportMatch,
} from '../api'
import { usePersonalTranslation } from '../personal-i18n'
import { duplicateBadgeLabel } from './duplicate-badge'
import {
  buildPersonalDrafts,
  toPersonalImportRequestRow,
  type PersonalDraftRow,
} from './personal-import-model'

const MAX_FILE_BYTES = 16 * 1024 * 1024

type Step = 'file' | 'mapping' | 'review' | 'done'

function matchBadge(
  matches: PersonalImportMatch[],
  t: (key: string) => string,
) {
  const label = duplicateBadgeLabel(matches, t)
  if (!label) return null
  const shared = matches.some((match) => match.source === 'GROUP')
  return (
    <Badge variant={shared ? 'secondary' : 'outline'} className="shrink-0">
      {label}
    </Badge>
  )
}

export function PersonalImportPage() {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  useDocumentTitle(t('import.documentTitle'))
  const profileQuery = usePersonalProfile()
  const previewMutation = usePreviewPersonalImport()
  const commitMutation = useCommitPersonalImport()
  const importAttempt = useIdempotentCreate()

  const [step, setStep] = useState<Step>('file')
  const [error, setError] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [table, setTable] = useState<DelimitedTable | null>(null)
  const [mapping, setMapping] = useState<DelimitedExpenseMappingV1 | null>(null)
  const [negativeIs, setNegativeIs] = useState<'expense' | 'income'>('expense')
  const [drafts, setDrafts] = useState<PersonalDraftRow[]>([])
  const [duplicateByRow, setDuplicateByRow] = useState<
    Map<string, PersonalImportMatch[]>
  >(new Map())
  const [resultCount, setResultCount] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const parseRequest = useRef(0)

  const profileCurrency = profileQuery.data?.currencyCode ?? 'USD'

  const chooseFile = async (file: File) => {
    setError(null)
    if (
      !/\.(csv|tsv|txt)$/i.test(file.name) &&
      !file.type.startsWith('text/')
    ) {
      setError(t('import.fileHint'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t('import.fileHint'))
      return
    }
    const request = ++parseRequest.current
    setIsParsing(true)
    try {
      const bytes = await file.arrayBuffer()
      const parsed = await parseExpenseFile(bytes, {
        encoding: 'AUTO' as DelimitedEncoding,
        headerRow: 0,
      })
      if (request !== parseRequest.current) return
      if (!parsed.ok) throw new Error(parsed.error)
      const inference = await inferExpenseFile(
        parsed.table,
        profileCurrency,
        preferredDateOrder(),
      )
      if (request !== parseRequest.current) return
      setTable(parsed.table)
      setMapping(inference.mapping)
      setStep('mapping')
      const mappedPreview = await previewExpenseFile(
        parsed.table,
        inference.mapping,
        { preferredDateOrder: preferredDateOrder() },
      )
      void mappedPreview
    } catch (fileError) {
      if (request !== parseRequest.current) return
      setError(fileError instanceof Error ? fileError.message : 'Parse failed')
    } finally {
      if (request === parseRequest.current) setIsParsing(false)
    }
  }

  const startReview = async () => {
    if (!table || !mapping) return
    setError(null)
    try {
      const mappedRows = await mapExpenseFile(table, mapping, undefined, {
        preferredDateOrder: preferredDateOrder(),
      })
      const nextDrafts = buildPersonalDrafts(mappedRows, {
        negativeIs,
        fallbackTitle: 'Imported transaction',
      })
      if (nextDrafts.every((row) => row.error)) {
        throw new Error(t('import.noRows'))
      }
      setDrafts(nextDrafts)
      setStep('review')
      const preview = await previewMutation.mutateAsync({
        rows: nextDrafts
          .filter((row) => !row.error)
          .map(toPersonalImportRequestRow),
      })
      setDuplicateByRow(
        new Map(preview.rows.map((row) => [row.rowId, row.matches])),
      )
      setDrafts((current) =>
        current.map((row) => {
          const matches =
            preview.rows.find((entry) => entry.rowId === row.mapped.rowId)
              ?.matches ?? []
          return matches.length > 0 ? { ...row, selected: false } : row
        }),
      )
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Review failed',
      )
    }
  }

  const refreshDuplicates = async () => {
    setError(null)
    try {
      const preview = await previewMutation.mutateAsync({
        rows: drafts
          .filter((row) => !row.error)
          .map(toPersonalImportRequestRow),
      })
      setDuplicateByRow(
        new Map(preview.rows.map((row) => [row.rowId, row.matches])),
      )
      setDrafts((current) =>
        current.map((row) => {
          const matches =
            preview.rows.find((entry) => entry.rowId === row.mapped.rowId)
              ?.matches ?? []
          return matches.length > 0 ? { ...row, selected: false } : row
        }),
      )
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : 'Review failed',
      )
    }
  }

  const setSelected = (rowId: string, selected: boolean) => {
    setDrafts((current) =>
      current.map((row) =>
        row.mapped.rowId === rowId ? { ...row, selected } : row,
      ),
    )
  }

  const approveRow = (rowId: string) => {
    setDrafts((current) =>
      current.map((row) => {
        if (row.mapped.rowId !== rowId) return row
        return {
          ...row,
          selected: true,
          approvedDuplicateKeys:
            duplicateByRow.get(rowId)?.map((match) => match.key) ?? [],
        }
      }),
    )
  }

  const setCategory = (rowId: string, categoryId: string) => {
    setDrafts((current) =>
      current.map((row) =>
        row.mapped.rowId === rowId ? { ...row, categoryId } : row,
      ),
    )
    setMapping((current) =>
      applyCategoryBindingAssignment(current, rowId, {
        mode: 'source',
        categoryId: categoryId as CategoryId,
      }),
    )
  }

  const commit = async () => {
    const selected = drafts.filter((row) => row.selected && !row.error)
    if (selected.length === 0) {
      setError(t('import.noRows'))
      return
    }
    setError(null)
    try {
      const result = await importAttempt.run((requestId) =>
        commitMutation.mutateAsync({
          requestId,
          rows: selected.map(toPersonalImportRequestRow),
        }),
      )
      if (!result) return
      setResultCount(result.importedCount)
      setStep('done')
    } catch (commitError) {
      setError(
        commitError instanceof Error ? commitError.message : 'Import failed',
      )
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-24">
      <div>
        <h1 className="text-xl font-semibold">{t('import.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('import.description')}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Import</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error}</span>
            {step === 'review' ? (
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshDuplicates()}
                >
                  {t('import.retryCheck')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep('mapping')}
                >
                  {t('import.backToMapping')}
                </Button>
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {step === 'file' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.chooseFile')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t('import.fileHint')}
            </p>
            <Input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void chooseFile(file)
              }}
            />
            <div>
              <Button
                type="button"
                disabled={isParsing}
                onClick={() => fileInput.current?.click()}
              >
                {isParsing ? (
                  <Loader2 className="me-2 size-4 animate-spin" />
                ) : (
                  <Upload className="me-2 size-4" />
                )}
                {t('import.chooseFile')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 'mapping' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.mappingTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t('import.mappingDescription')}
            </p>
            <div className="space-y-2">
              <Label htmlFor="personal-import-negative">
                {t('import.negativeIsLabel')}
              </Label>
              <Select
                value={negativeIs}
                onValueChange={(value) => {
                  if (value === 'expense' || value === 'income') {
                    setNegativeIs(value)
                  }
                }}
              >
                <SelectTrigger id="personal-import-negative" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">
                    {t('import.negativeExpense')}
                  </SelectItem>
                  <SelectItem value="income">
                    {t('import.negativeIncome')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void startReview()}>
                {t('import.reviewTitle')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('file')}
              >
                {t('import.backToTransactions')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 'review' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.reviewTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t('import.reviewDescription')}
            </p>
            <ul className="divide-y divide-border/60">
              {drafts.map((row) => {
                const matches = duplicateByRow.get(row.mapped.rowId) ?? []
                return (
                  <li
                    key={row.mapped.rowId}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
                  >
                    <Checkbox
                      checked={row.selected}
                      disabled={Boolean(row.error)}
                      onCheckedChange={(checked) =>
                        setSelected(row.mapped.rowId, checked === true)
                      }
                      aria-label={t('import.selectRow')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <Badge
                          variant={
                            row.kind === 'INCOME' ? 'secondary' : 'outline'
                          }
                        >
                          {row.kind}
                        </Badge>
                        <span className="truncate">{row.title}</span>
                        {matchBadge(matches, t)}
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {row.date} ·{' '}
                        {(() => {
                          const currency = getCurrency(
                            row.currency ||
                              profileQuery.data?.currencyCode ||
                              'USD',
                          )
                          return currency
                            ? formatCurrency(currency, row.amount, locale)
                            : `${row.amount} ${row.currency}`
                        })()}
                      </p>
                      {row.error ? (
                        <p className="text-xs text-destructive">{row.error}</p>
                      ) : null}
                    </div>
                    <div className="w-48">
                      <CategorySelector
                        categories={DEFAULT_CATEGORIES}
                        defaultValue="general"
                        isLoading={false}
                        mode="single"
                        selectedValues={
                          row.categoryId ? [row.categoryId as CategoryId] : []
                        }
                        onValueChange={(value) => {
                          if (value) setCategory(row.mapped.rowId, value)
                        }}
                        onValueToggle={(value) =>
                          setCategory(row.mapped.rowId, value)
                        }
                        ariaLabel={row.title}
                      />
                    </div>
                    {matches.length > 0 && !row.selected ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => approveRow(row.mapped.rowId)}
                      >
                        <Check className="me-1.5 size-3.5" />
                        {t('import.approveDuplicates')}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={commitMutation.isPending}
                onClick={() => void commit()}
              >
                {commitMutation.isPending ? (
                  <Loader2 className="me-2 size-4 animate-spin" />
                ) : null}
                {t('import.commit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 'done' ? (
        <Card>
          <CardContent
            spacing="standalone"
            className="flex flex-col items-center gap-3 py-10 text-center"
          >
            <p className="font-medium">{t('import.successTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('import.importedCount', { count: resultCount })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                nativeButton={false}
                render={<Link to="/personal/transactions" />}
              >
                {t('import.categorizeCta')}
              </Button>
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/personal/transactions" />}
              >
                {t('import.backToTransactions')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

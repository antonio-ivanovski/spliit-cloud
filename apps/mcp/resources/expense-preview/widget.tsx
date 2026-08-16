import {
  getPublicBaseUrl,
  useCallTool,
  useOpenExternal,
  useToolContext,
} from 'mcp-use/react'
import React, { useMemo, useState } from 'react'

import '../styles.css'
import { type ExpensePreviewMetadata } from './types'

const spliitLogo = `${getPublicBaseUrl()}icon.svg`

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function ExpensePreview() {
  const view = useToolContext<'prepare-expense'>()
  const openExternal = useOpenExternal()
  const [created, setCreated] = useState<{
    expenseId: string
    expenseUrl: string
  } | null>(null)
  const createExpense = useCallTool('create-expense')

  const props = view.status === 'ready' ? view.toolOutput : undefined
  const metadata =
    view.status === 'ready'
      ? (view.meta as ExpensePreviewMetadata | undefined)
      : undefined

  const formatter = useMemo(() => {
    if (!props?.preview) return null
    const code = props.preview.expenseCurrency.code
    return code
      ? new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
        })
      : null
  }, [props?.preview])

  const ledgerFormatter = useMemo(() => {
    const conversion = props?.preview?.conversion
    if (!conversion?.ledgerCurrencyCode) return null
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: conversion.ledgerCurrencyCode,
    })
  }, [props?.preview?.conversion])

  const shareFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
        useGrouping: false,
      }),
    [],
  )

  if (view.status === 'pending') {
    return (
      <main className="expense-card skeleton" aria-busy="true">
        <div className="skeleton-line short" />
        <div className="skeleton-line amount" />
        <div className="skeleton-line" />
      </main>
    )
  }

  if (view.status === 'error' || !props?.preview) {
    return (
      <main className="expense-card" aria-label="Expense preview">
        <p className="error" role="alert">
          The expense preview could not be loaded. Ask the assistant to try
          again.
        </p>
      </main>
    )
  }

  const { preview } = props
  const confirmationToken = metadata?.confirmationToken
  const displayAmount = formatter
    ? formatter.format(
        preview.amountMinor / 10 ** preview.expenseCurrency.decimalDigits,
      )
    : `${preview.amount} ${preview.expenseCurrency.symbol}`
  const formatMinor = (minor: number) =>
    formatter
      ? formatter.format(minor / 10 ** preview.expenseCurrency.decimalDigits)
      : `${minor / 10 ** preview.expenseCurrency.decimalDigits} ${preview.expenseCurrency.symbol}`
  const ledgerAmount = preview.conversion
    ? ledgerFormatter
      ? ledgerFormatter.format(
          preview.conversion.ledgerAmountMinor /
            10 ** preview.conversion.ledgerDecimalDigits,
        )
      : `${preview.conversion.ledgerAmountMinor / 10 ** preview.conversion.ledgerDecimalDigits} ${preview.conversion.ledgerCurrencySymbol}`
    : null
  const splitValue = (mode: string, shares: number) => {
    if (mode === 'BY_PERCENTAGE') return `${shares / 100}%`
    if (mode === 'BY_AMOUNT' || mode === 'ITEMIZED') {
      return formatMinor(shares)
    }
    if (mode === 'BY_SHARES') {
      // Preview transport keeps stored fixed units (100 = 1 displayed
      // share); divide only here for display.
      const display = shares / 100
      return `${shareFormatter.format(display)} ${display === 1 ? 'share' : 'shares'}`
    }
    return 'Equal'
  }
  const splitLabel = preview.split.mode
    .replace('BY_', '')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase())

  async function create() {
    if (!confirmationToken) return
    const result = await createExpense.callTool({
      confirmationToken,
    })
    const data = result.structuredContent
    if (data?.expenseId && data.expenseUrl) {
      setCreated({ expenseId: data.expenseId, expenseUrl: data.expenseUrl })
    }
  }

  return (
    <main className="expense-card" aria-label="Expense preview">
      <header className="card-header">
        <div className="brand-lockup">
          <span className="logo-frame">
            <img src={spliitLogo} alt="Spliit logo" />
          </span>
          <div className="title-lockup">
            <p className="eyebrow">Ready to add in {preview.group.name}</p>
            <h1>{preview.title}</h1>
          </div>
        </div>
        <span className="preview-badge">Preview</span>
      </header>

      <div className="amount-block">
        <div>
          <strong>{displayAmount}</strong>
          {ledgerAmount && (
            <span className="converted-amount">
              {ledgerAmount} in group currency
            </span>
          )}
        </div>
        <span className="expense-date">{preview.date}</span>
      </div>

      {preview.defaults.length > 0 && (
        <div className="defaults" aria-label="Defaults used">
          <div className="defaults-heading">
            <span className="defaults-check" aria-hidden="true">
              ✓
            </span>
            <strong>Defaults applied</strong>
          </div>
          <dl>
            {preview.defaults.map((item) => (
              <div key={item.field}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {preview.items.length > 0 && (
        <section className="items-section" aria-labelledby="items-title">
          <div className="section-heading">
            <h2 id="items-title">Items</h2>
            <span>
              {preview.items.length}{' '}
              {preview.items.length === 1 ? 'line' : 'lines'}
            </span>
          </div>
          <div className="item-list">
            {preview.items.map((item) => (
              <article className="expense-item" key={item.lineId}>
                <div className="item-primary">
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.quantity} × {formatMinor(item.unitPriceMinor)}
                    </span>
                  </div>
                  <strong>{formatMinor(item.amountMinor)}</strong>
                </div>
                <div className="item-allocations">
                  {item.split.participants.map((person) => (
                    <span key={person.participantId}>
                      {person.name}
                      <b>{splitValue(item.split.mode, person.shares)}</b>
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {preview.remainder && (
              <article className="expense-item remainder-item">
                <div className="item-primary">
                  <div>
                    <strong>Tax, tip &amp; remainder</strong>
                    <span>Difference from item subtotals</span>
                  </div>
                  <strong>{formatMinor(preview.remainder.amountMinor)}</strong>
                </div>
                <div className="item-allocations">
                  {preview.remainder.split.participants.map((person) => (
                    <span key={person.participantId}>
                      {person.name}
                      <b>
                        {splitValue(
                          preview.remainder!.split.mode,
                          person.shares,
                        )}
                      </b>
                    </span>
                  ))}
                </div>
              </article>
            )}
          </div>
        </section>
      )}

      <section className="details-grid">
        <div>
          <h2>Paid by</h2>
          {preview.paidBy.map((person) => (
            <div className="person" key={person.participantId}>
              <span className="avatar" aria-hidden="true">
                {initials(person.name)}
              </span>
              <span className="person-name">{person.name}</span>
              <span className="allocation">{formatMinor(person.shares)}</span>
            </div>
          ))}
        </div>
        <div>
          <h2>Split {splitLabel}</h2>
          {preview.split.participants.map((person) => (
            <div className="person" key={person.participantId}>
              <span className="avatar secondary" aria-hidden="true">
                {initials(person.name)}
              </span>
              <span className="person-name">{person.name}</span>
              <span className="allocation">
                {splitValue(preview.split.mode, person.shares)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <dl className="metadata">
        <div>
          <dt>Category</dt>
          <dd>{preview.category}</dd>
        </div>
        {preview.notes && (
          <div>
            <dt>Notes</dt>
            <dd>{preview.notes}</dd>
          </div>
        )}
      </dl>

      <footer>
        {created ? (
          <output className="success">
            <div>
              <strong>Expense created</strong>
              <span>ID {created.expenseId}</span>
            </div>
            <button
              type="button"
              className="open-link"
              onClick={() => void openExternal({ url: created.expenseUrl })}
            >
              Open in Spliit
            </button>
          </output>
        ) : (
          <>
            {!confirmationToken && (
              <p className="error" role="alert">
                This preview can no longer be confirmed. Ask the assistant for a
                fresh one.
              </p>
            )}
            {createExpense.error && (
              <p className="error" role="alert">
                {(createExpense.error instanceof Error
                  ? createExpense.error.message
                  : 'The request failed'
                )
                  .toLowerCase()
                  .includes('expired')
                  ? 'This preview expired. Ask the assistant for a fresh one.'
                  : 'The expense was not created. Your preview is unchanged; you can retry.'}
              </p>
            )}
            <button
              type="button"
              className="create-button"
              disabled={createExpense.isPending || !confirmationToken}
              onClick={() => void create()}
            >
              {createExpense.isPending ? 'Creating…' : 'Create expense'}
            </button>
            <p className="confirmation-copy">
              This creates exactly what is shown above. To make corrections, ask
              the assistant for a new preview.
            </p>
          </>
        )}
      </footer>
    </main>
  )
}

export default ExpensePreview

import { SettlementBalanceList } from '@web/app/groups/[groupId]/balances/settlement-ui'
import { CategoryIcon } from '@web/app/groups/[groupId]/expenses/category-icon'
import { AmountInput } from '@web/app/groups/[groupId]/expenses/expense-form/amount-input'
import { ParticipantShareRow } from '@web/app/groups/[groupId]/expenses/expense-form/participant-share-row'
import { PaidForSplitOptionCards } from '@web/app/groups/[groupId]/expenses/expense-form/split-option-cards'
import { ConfirmStep } from '@web/app/groups/import/confirm-step'
import { DoneStep } from '@web/app/groups/import/done-step'
import { StepHeader } from '@web/app/groups/import/wizard-nav'
import { CategorySelector } from '@web/components/category-selector'
import { CurrencySelector } from '@web/components/currency-selector'
import { GroupEmojiBadge } from '@web/components/group-emoji-badge'
import { ParticipantAvatar } from '@web/components/participant-avatar'
import { Button } from '@web/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { ArrowLeft, ChevronRight, Plus, Save } from 'lucide-react'
import type { ReactNode } from 'react'

import { DEFAULT_CATEGORIES } from '@spliit/domain'

import {
  currency,
  expenses,
  friendBalances,
  groupBalances,
  importExpenses,
  importPeople,
  importParticipants,
  importSource,
  money,
  people,
  pizza,
} from './fixture'

const noop = () => {}

/**
 * Offline crops of production presentation. Basic-details and expense-row
 * markup is traced to expense-form/basic-details-card.tsx and
 * expenses/expense-card.tsx. Router links, live hooks, and out-of-crop sections
 * are omitted; controls aren't rearranged into invented screens. Editorial
 * headings live outside these crops.
 */
function TitleAmountFields() {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Button variant="ghost" size="icon" className="-ms-2">
          <ArrowLeft className="size-4" />
        </Button>
        <CardTitle>Create expense</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-6">
        <div className="grid gap-2">
          <Label htmlFor="roast-title">Expense title</Label>
          <div className="flex min-h-10 overflow-hidden rounded-md border border-input bg-background">
            <CategorySelector
              categories={DEFAULT_CATEGORIES}
              defaultValue="food-and-drink"
              compact
              onValueChange={noop}
              isLoading={false}
            />
            <div className="min-w-0 flex-1 border-s border-input">
              <Input
                id="roast-title"
                value={pizza.title}
                readOnly
                className="h-10 rounded-none border-0 text-base shadow-none"
              />
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="roast-amount">Amount</Label>
          <div className="flex min-h-10 overflow-hidden rounded-md border border-input bg-background">
            <CurrencySelector
              currencies={[{ ...currency, name: 'US Dollar' }]}
              defaultValue="USD"
              compact
              onValueChange={noop}
              isLoading={false}
            />
            <div className="min-w-0 flex-1 border-s border-input">
              <AmountInput
                id="roast-amount"
                currency={currency}
                value={(pizza.amount / 100).toFixed(2)}
                readOnly
                containerClassName="min-w-0 flex-1"
                className="h-10 w-full rounded-none border-0 text-lg font-semibold shadow-none"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ExpenseEditor({
  pressed,
  two = false,
}: {
  pressed: boolean
  two?: boolean
}) {
  return (
    <div className="space-y-4">
      <TitleAmountFields />
      {/* A close crop of the selected equal-split participant rows. */}
      <Card>
        <CardHeader>
          <CardTitle>Split between</CardTitle>
          <CardDescription>
            Select the participants who share this expense.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaidForSplitOptionCards
            value="EVENLY"
            onChange={noop}
            renderContent={(mode) =>
              mode === 'EVENLY' ? (
                <div>
                  {people.slice(0, two ? 2 : 3).map((person) => (
                    <ParticipantShareRow
                      key={person.id}
                      participant={person}
                      checked
                      onCheckedChange={noop}
                      preview={money(pizza.amount / (two ? 2 : 3))}
                    />
                  ))}
                </div>
              ) : null
            }
          />
        </CardContent>
      </Card>
      <div className="roast-form-actions flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button style={{ transform: pressed ? 'scale(.96)' : undefined }}>
          <Save className="size-4" />
          Create expense
        </Button>
      </div>
    </div>
  )
}

function ExpenseRow({
  expense,
  two = false,
  accent = false,
  imported = false,
}: {
  expense: (typeof expenses)[number]
  two?: boolean
  accent?: boolean
  imported?: boolean
}) {
  return (
    <div
      className={`relative flex items-stretch justify-between gap-1 rounded-lg px-6 py-4 text-sm ${accent ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
    >
      <CategoryIcon
        category={DEFAULT_CATEGORIES.find(
          (category) =>
            category.id ===
            (expense.title === 'Taxi'
              ? 'transportation'
              : expense.title === 'Apartment'
                ? 'home'
                : 'food-and-drink'),
        )!}
        className="me-2 mt-0.5 size-4 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <span>{expense.title}</span>
        </div>
        <div className="mb-1 text-xs text-muted-foreground">Oct 10, 2026</div>
        <div className="text-xs text-muted-foreground">
          Paid by <strong>Alex</strong> · split between{' '}
          <strong>
            {imported
              ? importPeople.map((person) => person.name).join(', ')
              : `Alex, Jamie${!two ? ', Sam' : ''}`}
          </strong>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <div className="font-bold whitespace-nowrap tabular-nums">
          {money(expense.amount)}
        </div>
      </div>
      <ChevronRight className="pointer-events-none size-4 self-center" />
    </div>
  )
}

export function SavedExpenses({ imported = false }: { imported?: boolean }) {
  return (
    <div className="roast-expense-list space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-rounded text-3xl font-semibold">Expenses</h2>
        <Button>
          <Plus className="size-4" />
          Add expense
        </Button>
      </div>
      <div className="divide-y rounded-lg border bg-card">
        {(imported ? importExpenses.slice(0, 5) : expenses)
          .toReversed()
          .map((expense) => (
            <ExpenseRow
              key={expense.title}
              expense={expense}
              accent={expense === pizza}
              imported={imported}
            />
          ))}
      </div>
    </div>
  )
}

function BalanceCrop({ two = false }: { two?: boolean }) {
  const balances = two ? friendBalances : groupBalances
  return (
    <Card>
      <CardHeader>
        <CardTitle>Net balances</CardTitle>
      </CardHeader>
      <CardContent>
        <SettlementBalanceList
          identities={balances}
          currency={currency}
          locale="en-US"
          amountLabel={({ amount, isReceiving }) => (
            <>
              {isReceiving ? 'To receive' : 'To pay'} {amount}
            </>
          )}
        />
      </CardContent>
    </Card>
  )
}

export function GroupDemo({ balance }: { balance: boolean }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon">
          <ArrowLeft className="size-5" />
        </Button>
        <GroupEmojiBadge emoji="🌴" color={null} size="md" />
        <h2 className="font-rounded text-2xl font-bold">Barcelona weekend</h2>
      </div>
      {balance ? <BalanceCrop /> : <SavedExpenses />}
    </div>
  )
}

export function FriendDemo({ saved }: { saved: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ParticipantAvatar participant={people[1]} size="lg" />
        <h2 className="font-rounded text-3xl font-semibold">Jamie</h2>
      </div>
      {saved ? (
        <>
          <div className="rounded-lg border bg-card">
            <ExpenseRow expense={pizza} two accent />
          </div>
          <BalanceCrop two />
        </>
      ) : (
        <ExpenseEditor pressed={false} two />
      )}
    </div>
  )
}

export function ImportReview({ pressed = false }: { pressed?: boolean }) {
  return (
    <div
      className={`roast-import-review space-y-6 ${pressed ? 'roast-import-pressed' : ''}`}
    >
      <StepHeader step="confirm" />
      <ConfirmStep
        source={importSource}
        mode="NEW_GROUP"
        targetGroupId={null}
        groupFormValues={{
          name: importSource.name,
          information: '',
          currency: '$',
          currencyCode: 'USD',
        }}
        participants={importParticipants}
        resolvedExpenses={importSource.expenses}
        isSubmitting={false}
        conversionModes={{}}
        rates={undefined}
        onBack={noop}
        onSubmit={noop}
      />
    </div>
  )
}

/** Editorial travel is followed by authentic review and saved states. */
export function ImportWorkflow({ frame }: { frame: number }) {
  if (frame < 195) return <ImportReview pressed={frame >= 177} />
  if (frame < 210)
    return (
      <div className="space-y-6">
        <StepHeader step="done" />
        <DoneStep groupId="barcelona-trip" invites={[]} onContinue={noop} />
      </div>
    )
  return <SavedExpenses imported />
}

export function AppCrop({ children }: { children: ReactNode }) {
  return (
    <div className="roast-app-crop">
      <div className="roast-app-content">{children}</div>
    </div>
  )
}

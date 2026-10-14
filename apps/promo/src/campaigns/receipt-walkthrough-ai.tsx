import { AiReceiptItems } from '@web/app/groups/[groupId]/expenses/ai-receipt-items'
import { DefaultSplitAction } from '@web/app/groups/[groupId]/expenses/expense-form/default-split-action'
import {
  ExpenseItemRow,
  expenseItemGridClass,
} from '@web/app/groups/[groupId]/expenses/expense-form/expense-item-row'
import { ParticipantShareRow } from '@web/app/groups/[groupId]/expenses/expense-form/participant-share-row'
import { SplitDistributionEditor } from '@web/app/groups/[groupId]/expenses/expense-form/split-distribution-editor'
import { PaidForSplitOptionCards } from '@web/app/groups/[groupId]/expenses/expense-form/split-option-cards'
import { SplitPresetPanel } from '@web/app/groups/[groupId]/expenses/expense-form/split-preset-panel'
import {
  AiExpenseFields,
  ReceiptScanningOverlay,
  ReceiptUploadAction,
} from '@web/app/groups/[groupId]/expenses/receipt-presentation'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card'
import { DialogFooter, DialogHeader } from '@web/components/ui/dialog'
import { Form } from '@web/components/ui/form'
import { Input } from '@web/components/ui/input'
import { getCurrency } from '@web/lib/currency'
import {
  ChartPie,
  FolderOpen,
  Check,
  ChevronUp,
  Pencil,
  Receipt,
  ShoppingCart,
  X,
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { I18nextProvider, useTranslation } from 'react-i18next'
import {
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from 'remotion'

import type { ExpenseFormInputValues } from '@spliit/domain'

import { BrandHeader, Canvas } from '../primitives'
import { i18n } from '../video/local-i18n'
import { ActionCue, Highlight } from '../video/motion'
import {
  receiptAiItemsAt,
  receiptAiActions as actions,
  receiptAiBeats as beats,
  receiptAiStoryboard as script,
  receiptAiTimeline as timeline,
} from './receipt-ai-storyboard'
import {
  allocations,
  money,
  participants,
  receipt,
  receiptDate,
} from './receipt-fixture'
import { PaperReceipt } from './receipt-scan'

import './receipt-walkthrough-ai.css'

const currency = getCurrency('USD')!
const people = participants.map((name) => ({ id: name.toLowerCase(), name }))
// The reused rows consume only participant identity; no live group state is loaded.
const group = {
  id: 'promo-friends',
  name: receipt.group,
  participants: people,
} as ComponentProps<typeof ExpenseItemRow>['group']
const noop = () => {}

function Panel({
  title,
  description,
  children,
  ai = false,
}: {
  title: string
  description?: string
  children: ReactNode
  ai?: boolean
}) {
  return (
    <section className="ai-app-panel relative grid gap-4 rounded-lg border bg-background p-6 shadow-lg">
      <DialogHeader>
        <h2 className="flex items-center gap-2 text-lg leading-none font-semibold">
          {ai && (
            <>
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Receipt className="size-5" />
              </span>
            </>
          )}
          {title}
          {ai && <Badge variant="secondary">AI</Badge>}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </DialogHeader>
      {children}
      <X className="absolute end-4 top-4 size-4 opacity-70" />
    </section>
  )
}
function Story({
  heading,
  children,
}: {
  heading: string
  children: ReactNode
}) {
  return (
    <div className="ai-story">
      <h1>{heading}</h1>
      <div className="ai-stage">{children}</div>
    </div>
  )
}
function Bookend({ frame }: { frame: number }) {
  const outro = frame >= beats.outro.from
  const speed = !outro && frame >= beats.introSpeed.from
  const start = outro
    ? beats.outro.from
    : speed
      ? beats.introSpeed.from
      : beats.introFeature.from
  const enter = interpolate(frame - start, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <section
      className="ai-bookend"
      style={{ opacity: enter, transform: `translateY(${(1 - enter) * 12}px)` }}
    >
      {outro ? (
        <>
          <h1>Your next shared expense starts here.</h1>
          <p>Try Spliit Cloud at</p>
          <strong className="ai-destination">spliit.cloud</strong>
        </>
      ) : speed ? (
        <>
          <h1>Receipt scanning, accelerated.</h1>
          <p className="ai-version">Spliit Cloud 2.7.0</p>
          <strong className="ai-speed">
            ~5× <span>faster</span>
          </strong>
          <p>
            Smaller receipts scanned in under 10 seconds
            <br />
            with line items extracted.
          </p>
        </>
      ) : (
        <>
          <Receipt className="ai-bookend-icon" />
          <h1>Turn receipts into shared expenses.</h1>
          <p>
            Spliit Cloud extracts the details and items.
            <br />
            You choose who shares each item.
          </p>
        </>
      )}
    </section>
  )
}
function Upload({ frame }: { frame: number }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'CreateFromReceipt.Dialog',
  })
  return (
    <Story heading="From receipt to shared expense.">
      <div className="ai-upload">
        <PaperReceipt />
        <Panel title={t('title')} description={t('description')}>
          <p className="text-sm">{t('body')}</p>
          <Highlight
            activeFrom={actions.upload - 35}
            activeTo={actions.upload + 10}
          >
            <ActionCue at={actions.upload}>
              <ReceiptUploadAction
                label={t('scanReceipt')}
                cameraLabel={t('takePhoto')}
                onScan={noop}
                onCamera={noop}
              />
            </ActionCue>
          </Highlight>
          {frame >= actions.upload && (
            <p className="text-sm text-muted-foreground">
              freshmart-receipt.jpg
            </p>
          )}
        </Panel>
      </div>
    </Story>
  )
}
function Extract({ frame }: { frame: number }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'CreateFromReceipt.Dialog',
  })
  const local = frame - beats.ocr.from
  const phase = frame < beats.llm.from ? 0 : frame < beats.jev.from ? 1 : 2
  const cards = [
    ['OCR', 'Read receipt text.', 'Text recognition reads the receipt.'],
    [
      'LLM',
      'Structure expense details.',
      'A language model structures the text. Vision is available as a fallback.',
    ],
    [
      'Jev',
      'Suggest a category.',
      'A decision model handles categorization. Designed to balance speed, extraction quality, and cost.',
    ],
  ]
  return (
    <Story heading="Different models. Focused roles.">
      <div className="ai-extraction">
        <Panel title={t('title')} description={t('description')}>
          <div className="relative flex min-h-48 justify-center overflow-hidden rounded border bg-muted/20">
            <div className="ai-receipt-photo">
              <PaperReceipt />
            </div>
            <ReceiptScanningOverlay
              hint={t('scanningHint')}
              pulse={0.8 + 0.2 * Math.sin(local / 12)}
            />
          </div>
        </Panel>
        <aside className="ai-explanation" aria-label="How extraction works">
          <span className="ai-role">{cards[phase][0]}</span>
          <h2>{cards[phase][1]}</h2>
          <p>{cards[phase][2]}</p>
          <small>The route depends on configuration.</small>
          <span className="ai-demo-label">Demo sped up</span>
        </aside>
      </div>
    </Story>
  )
}
function Review() {
  const { t } = useTranslation(undefined, { keyPrefix: 'AIExpense' })
  const fields = [
    [t('group'), receipt.group],
    [t('expenseTitle'), receipt.merchant],
    [t('amount'), money(receipt.total)],
    [t('date'), receiptDate],
    [
      t('category'),
      <span key="category" className="inline-flex items-center gap-1">
        <ShoppingCart className="size-4" />
        Groceries
      </span>,
    ],
    [t('split'), t('defaultSplit')],
  ] as const
  return (
    <Story heading="Check what AI extracted.">
      <Panel title={t('title')} description={t('description')} ai>
        <AiExpenseFields>
          {fields.map(([label, value], index) => (
            <div key={label} className={index < 2 ? 'col-span-2' : ''}>
              <div className="text-xs font-medium text-muted-foreground">
                {label}
              </div>
              <div className={index === 0 ? 'font-medium' : ''}>{value}</div>
            </div>
          ))}
          <div className="col-span-2 border-t pt-3">
            <AiReceiptItems
              items={receipt.items.map((item) => ({
                title: item.title,
                unitPrice: item.amount / 100,
                quantity: 1,
              }))}
              currency={currency}
              locale="en-US"
              heading={t('items')}
            />
          </div>
        </AiExpenseFields>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Highlight
            activeFrom={actions.editDetails - 60}
            activeTo={actions.editDetails + 10}
          >
            <ActionCue at={actions.editDetails}>
              <Button variant="outline">
                <Pencil className="me-2 size-4" />
                {t('edit')}
              </Button>
            </ActionCue>
          </Highlight>
          <Button>
            <Check className="me-2 size-4" />
            {t('create')}
          </Button>
        </DialogFooter>
      </Panel>
    </Story>
  )
}
function ItemTable({ itemized, frame }: { itemized: boolean; frame: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const items = receiptAiItemsAt(frame)
  const form = useForm<ExpenseFormInputValues>({ defaultValues: { items } })
  return (
    <Form {...form}>
      <div
        className={
          expenseItemGridClass +
          ' mt-5 grid gap-x-3 border-t py-2 text-[11px] font-medium text-muted-foreground uppercase'
        }
      >
        <span>{t('items.columnItem')}</span>
        <span className="text-end">{t('items.columnCost')}</span>
        <span className="text-end">{t('items.columnQuantity')}</span>
        <span className="text-end">{t('items.columnTotal')}</span>
        <span />
      </div>
      {items.map((item, index) => (
        <Highlight
          key={item.id}
          activeFrom={index === 1 ? actions.openCoffee - 35 : -100}
          activeTo={index === 1 ? actions.openCoffee + 8 : -90}
        >
          <ExpenseItemRow
            form={form}
            itemIndex={index}
            item={item}
            group={group}
            groupCurrency={currency}
            onEdit={noop}
            onDelete={noop}
            hideAssignees={!itemized}
          />
        </Highlight>
      ))}
    </Form>
  )
}
function ParticipantEditor({
  selected,
  frame,
}: {
  selected: boolean
  frame: number
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  return (
    <Panel title="Coffee beans" description="$ × 1 × 12.50">
      <div className="ai-participant-viewport">
        <div
          style={{
            transform: `translateY(-${interpolate(frame, [actions.itemized + 38, actions.itemized + 128], [0, 120], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
          }}
        >
          <SplitPresetPanel label={t('SplitPreset.heading')}>
            <div className="flex items-center gap-2 text-muted-foreground">
              <ChartPie className="size-4" />
              <span className="text-xs font-medium tracking-[0.08em] uppercase">
                {t('SplitPreset.heading')}
              </span>
            </div>
            <span className="mt-3 block text-muted-foreground">
              {t('SplitPreset.untracked')}
            </span>
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
              >
                <FolderOpen className="size-3.5" />
                {t('SplitPreset.load')}
              </Button>
            </div>
          </SplitPresetPanel>
          <PaidForSplitOptionCards
            value="EVENLY"
            onChange={noop}
            renderContent={(mode) => (
              <SplitDistributionEditor
                participants={people}
                selectedCount={selected ? 1 : 2}
                mode={mode}
                targetAmount={1250}
                shares={selected ? [1] : [1, 1]}
                currency={currency}
                onReset={noop}
                onToggleAll={noop}
                renderRow={(person) => (
                  <Highlight
                    activeFrom={
                      person.id === 'alex' ? actions.selectJamie - 35 : -100
                    }
                    activeTo={
                      person.id === 'alex' ? actions.selectJamie + 10 : -90
                    }
                  >
                    <ActionCue
                      at={person.id === 'alex' ? actions.selectJamie : -100}
                    >
                      <ParticipantShareRow
                        participant={person}
                        checked={!selected || person.id === 'jamie'}
                        onCheckedChange={noop}
                        preview={
                          !selected || person.id === 'jamie'
                            ? money(selected ? 1250 : 625)
                            : undefined
                        }
                      />
                    </ActionCue>
                  </Highlight>
                )}
              />
            )}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline">{t('cancel')}</Button>
        <Highlight
          activeFrom={actions.saveCoffee - 40}
          activeTo={actions.saveCoffee + 10}
        >
          <ActionCue at={actions.saveCoffee}>
            <Button>{t('save')}</Button>
          </ActionCue>
        </Highlight>
      </DialogFooter>
    </Panel>
  )
}
function Editor({ frame }: { frame: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const committed = frame >= actions.saveCoffee + 8
  const modal = frame >= actions.itemized + 8 && !committed
  const confirm =
    frame >= actions.openCoffee + 8 && frame < actions.itemized + 8
  const heading =
    frame < beats.confirm.from
      ? 'Open coffee’s participant controls.'
      : frame < actions.itemized + 8
        ? 'Switch to itemized splitting.'
        : frame < beats.coffeeSelect.from
          ? 'Coffee starts shared by Alex and Jamie.'
          : frame < beats.coffeeSave.from
            ? 'Deselect Alex. Keep Jamie.'
            : frame < beats.save.from
              ? 'Save the participants.'
              : 'Milk and pasta stay shared.'
  return (
    <Story heading={heading}>
      <div className="ai-editor">
        <div className={modal || confirm ? 'ai-editor-underlay' : ''}>
          <Card>
            <CardHeader>
              <CardTitle>{receipt.merchant}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <label className="text-sm" htmlFor="promo-title">
                  Title
                  <Input
                    id="promo-title"
                    value={receipt.merchant}
                    onChange={noop}
                  />
                </label>
                <label className="text-sm" htmlFor="promo-amount">
                  Amount
                  <Input id="promo-amount" value="20.50" onChange={noop} />
                </label>
              </div>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{t('items.title')}</CardTitle>
                <CardDescription>{t('items.description')}</CardDescription>
              </div>
              <Button variant="ghost" size="sm">
                {t('items.hideItems')}
                <ChevronUp className="size-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {frame >= actions.itemized + 8 && (
                <DefaultSplitAction
                  splitMode="EVENLY"
                  label={t('items.allItemsSplitLabel')}
                  summary={
                    committed
                      ? t('items.allItemsSplitMixed')
                      : 'Split evenly: Alex, Jamie'
                  }
                  editLabel={t('items.allItemsSplitEdit')}
                  onClick={noop}
                />
              )}
              <ItemTable
                key={committed ? 'saved' : 'shared'}
                itemized={frame >= actions.itemized + 8}
                frame={frame}
              />
            </CardContent>
          </Card>
          <div className="mt-4 flex justify-end">
            <Highlight
              activeFrom={actions.createExpense - 50}
              activeTo={actions.createExpense + 10}
            >
              <ActionCue at={actions.createExpense}>
                <Button>Create expense</Button>
              </ActionCue>
            </Highlight>
          </div>
        </div>
        {confirm && (
          <div className="ai-confirm">
            <Panel
              title={t('items.switchToItemizedTitle')}
              description={t('items.switchToItemizedDescription')}
            >
              <DialogFooter>
                <Button variant="ghost">{t('cancel')}</Button>
                <Highlight
                  activeFrom={actions.itemized - 35}
                  activeTo={actions.itemized + 8}
                >
                  <ActionCue at={actions.itemized}>
                    <Button>{t('items.switchToItemizedConfirm')}</Button>
                  </ActionCue>
                </Highlight>
              </DialogFooter>
            </Panel>
          </div>
        )}
        {modal && (
          <div className="ai-participants">
            <ParticipantEditor
              selected={frame >= actions.selectJamie}
              frame={frame}
            />
          </div>
        )}
      </div>
    </Story>
  )
}
function Result() {
  return (
    <Story heading="Scan the items. Choose who shares them.">
      <div className="ai-result">
        <Check className="size-12 text-primary" />
        <h2>Expense created.</h2>
        <p>
          {receipt.merchant} · {money(receipt.total)}
        </p>
        <div className="ai-allocations">
          {allocations.map((person) => (
            <div key={person.name}>
              <span>{person.name}</span>
              <strong>{money(person.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Milk and pasta: Alex & Jamie · Coffee: Jamie
        </div>
      </div>
    </Story>
  )
}
export function ReceiptWalkthroughAi({
  audioEnabled = true,
  soundDesignEnabled = true,
}: {
  audioEnabled?: boolean
  soundDesignEnabled?: boolean
}) {
  const frame = useCurrentFrame()
  const Scene =
    frame < beats.upload.from || frame >= beats.outro.from
      ? Bookend
      : frame < beats.ocr.from
        ? Upload
        : frame < beats.review.from
          ? Extract
          : frame < beats.coffeeEdit.from
            ? Review
            : frame < beats.result.from
              ? Editor
              : Result
  return (
    <I18nextProvider i18n={i18n}>
      <Canvas width={1600} height={900} className="receipt-walkthrough-ai">
        <BrandHeader />
        <Scene frame={frame} />
        {audioEnabled && soundDesignEnabled && (
          <Audio
            src={staticFile('sound-design/receipt-walkthrough-ai/mix.wav')}
          />
        )}
        {audioEnabled &&
          !soundDesignEnabled &&
          timeline.map((beat) => (
            <Sequence
              key={beat.id}
              from={beat.from + script.leadFrames}
              durationInFrames={beat.durationInFrames - script.leadFrames}
              layout="none"
            >
              <Audio
                src={staticFile(
                  `narration/${script.compositionId}/${beat.id}.wav`,
                )}
              />
            </Sequence>
          ))}
        {frame >= beats.upload.from && frame < beats.outro.from && (
          <div className="ai-progress">
            {['Upload', 'Extract', 'Review', 'Choose shares', 'Save'].map(
              (label, index) => (
                <span
                  key={label}
                  className={
                    frame >=
                    [
                      beats.upload.from,
                      beats.ocr.from,
                      beats.review.from,
                      beats.coffeeEdit.from,
                      beats.result.from,
                    ][index]
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  }
                >
                  {index + 1} / {label}
                </span>
              ),
            )}
          </div>
        )}
      </Canvas>
    </I18nextProvider>
  )
}

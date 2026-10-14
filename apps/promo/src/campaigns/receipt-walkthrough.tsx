import {
  ReceiptItemRow,
  ReceiptItemsShell,
} from '@web/app/groups/[groupId]/expenses/receipt-items-shell'
import { Button } from '@web/components/ui/button'
import {
  Check,
  CheckCircle2,
  FileImage,
  Pencil,
  ScanLine,
  ShoppingCart,
  UserPen,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Sequence, useCurrentFrame, interpolate, staticFile } from 'remotion'
import { Audio } from 'remotion'

import { BrandHeader, Canvas, UiFrame } from '../primitives'
import { ActionCue, Entrance, Highlight, Reveal } from '../video/motion'
import {
  allocations,
  itemParticipants,
  money,
  participants,
  receipt,
  receiptDate,
} from './receipt-fixture'
import { PaperReceipt } from './receipt-scan'
import {
  receiptActionFrames,
  receiptStoryboard,
  receiptTimeline,
} from './receipt-storyboard'

import './receipt-walkthrough.css'

function Story({
  step,
  title,
  children,
  opening = false,
}: {
  step: string
  title: string
  children: ReactNode
  opening?: boolean
}) {
  return (
    <div className="walkthrough-story">
      <div className="walkthrough-copy">
        <Entrance delay={opening ? -24 : 0}>
          <span className="walkthrough-eyebrow">{step}</span>
          <h1>{title}</h1>
        </Entrance>
      </div>
      <div className="walkthrough-stage">
        <Entrance delay={opening ? -24 : 0}>{children}</Entrance>
      </div>
    </div>
  )
}
function PanelTitle({
  children,
  icon = 'receipt',
}: {
  children: ReactNode
  icon?: 'receipt' | 'edit'
}) {
  const Icon = icon === 'receipt' ? ScanLine : Pencil
  return (
    <div className="walkthrough-panel-title">
      <Icon />
      <h2>{children}</h2>
      <X className="walkthrough-close" />
    </div>
  )
}
function ReceiptItems({ assigned = false }: { assigned?: boolean }) {
  return (
    <ReceiptItemsShell heading="Items">
      {receipt.items.map((item, index) => (
        <ReceiptItemRow
          key={item.title}
          title={item.title}
          amount={money(item.amount)}
          detail={
            assigned ? (
              <span>{itemParticipants[index].join(' & ')}</span>
            ) : undefined
          }
        />
      ))}
    </ReceiptItemsShell>
  )
}
function UploadScene() {
  const at = receiptActionFrames.upload
  return (
    <Story opening step="01 / Upload" title="From receipt to shared expense.">
      <div className="walkthrough-upload">
        <PaperReceipt />
        <UiFrame className="walkthrough-panel walkthrough-upload-panel">
          <PanelTitle>Create from receipt</PanelTitle>
          <p>Extract expense details from a receipt.</p>
          <div className="walkthrough-file">
            <FileImage />
            <strong>freshmart-receipt.jpg</strong>
            <span>Receipt photo</span>
          </div>
          <Highlight activeFrom={at - 35} activeTo={at + 10}>
            <ActionCue at={at}>
              <Button className="walkthrough-button">
                <ScanLine />
                Scan receipt
              </Button>
            </ActionCue>
          </Highlight>
        </UiFrame>
      </div>
    </Story>
  )
}
function ScanScene() {
  const frame = useCurrentFrame()
  const duration = receiptTimeline[1].durationInFrames
  const y = interpolate(frame, [15, duration - 35], [0, 460], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <Story step="02 / AI extraction" title="The receipt becomes an item list.">
      <div className="walkthrough-scan">
        <div className="walkthrough-scan-paper">
          <PaperReceipt />
          <div className="walkthrough-scan-line" style={{ top: y }} />
        </div>
        <div className="walkthrough-extraction">
          <ScanLine />
          <h2>Reading your receipt…</h2>
          {['Store & date', 'Receipt total', 'Line items'].map(
            (text, index) => (
              <Reveal key={text} start={25 + index * 22} end={40 + index * 22}>
                <div className="walkthrough-extracted">
                  <CheckCircle2 />
                  {text}
                </div>
              </Reveal>
            ),
          )}
          <span className="walkthrough-speed">Demo sped up</span>
        </div>
      </div>
    </Story>
  )
}
function ReviewScene() {
  const at = receiptActionFrames.editDetails - receiptTimeline[2].from
  return (
    <Story step="03 / Review" title="Check what AI extracted.">
      <UiFrame className="walkthrough-panel walkthrough-review">
        <PanelTitle>Review AI expense</PanelTitle>
        <div className="walkthrough-fields">
          <div>
            <span>Group</span>
            <strong>{receipt.group}</strong>
          </div>
          <div>
            <span>Title</span>
            <strong>{receipt.merchant}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong>{money(receipt.total)}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{receiptDate}</strong>
          </div>
          <div>
            <span>Category</span>
            <strong>
              <ShoppingCart /> Groceries
            </strong>
          </div>
          <div>
            <span>Split</span>
            <strong>Evenly across participants</strong>
          </div>
        </div>
        <ReceiptItems />
        <div className="walkthrough-actions">
          <div className="walkthrough-annotated-action">
            <span className="walkthrough-hint">
              Choose splits in the editor
            </span>
            <Highlight activeFrom={at - 60} activeTo={at + 10}>
              <ActionCue at={at}>
                <Button variant="outline" className="walkthrough-button">
                  <Pencil />
                  Edit details
                </Button>
              </ActionCue>
            </Highlight>
          </div>
          <Button className="walkthrough-button">
            <Check />
            Create expense
          </Button>
        </div>
      </UiFrame>
    </Story>
  )
}
function EditorScene() {
  const frame = useCurrentFrame()
  const start = receiptTimeline[3].from
  const local = (index: number) => receiptTimeline[index].from - start
  const selectItemsAt = receiptActionFrames.itemized - start
  const openCoffeeAt = receiptActionFrames.openCoffee - start
  const selectJamieAt = receiptActionFrames.selectJamie - start
  const saveCoffeeAt = receiptActionFrames.saveCoffee - start
  const createAt = receiptActionFrames.createExpense - start
  const itemized = frame >= selectItemsAt
  const modal = frame >= openCoffeeAt && frame < saveCoffeeAt + 12
  const draftAssigned = frame >= selectJamieAt
  const assigned = frame >= saveCoffeeAt + 12
  const beat =
    frame >= local(7)
      ? 7
      : frame >= local(6)
        ? 6
        : frame >= local(5)
          ? 5
          : frame >= local(4)
            ? 4
            : 3
  const title = {
    3: 'Choose itemized splitting.',
    4: 'Who shares the coffee?',
    5: 'Keep Jamie. Deselect Alex.',
    6: 'Save the coffee participants.',
    7: 'Shared groceries. Personal coffee.',
  }[beat]
  return (
    <Story step="04 / Choose who shares" title={title}>
      <UiFrame className="walkthrough-panel walkthrough-editor">
        <PanelTitle icon="edit">Create expense</PanelTitle>
        <div className="walkthrough-editor-meta">
          <div>
            <span>Title</span>
            <strong>{receipt.merchant}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong>{money(receipt.total)}</strong>
          </div>
        </div>
        <div className="walkthrough-split-label">
          How should this expense be split?
        </div>
        <div className="walkthrough-split-options">
          <span className={!itemized ? 'selected' : ''}>Evenly</span>
          <Highlight activeFrom={45} activeTo={110}>
            <ActionCue at={selectItemsAt}>
              <span className={itemized ? 'selected' : ''}>
                By items {itemized && <Check />}
              </span>
            </ActionCue>
          </Highlight>
        </div>
        <div className="walkthrough-editor-items">
          <div className="walkthrough-item-header">
            <strong>Items</strong>
            <span>Line total</span>
          </div>
          {receipt.items.map((item, index) => (
            <div key={item.title} className="walkthrough-editor-row">
              <div>
                <strong>{item.title}</strong>
                <span>
                  {itemized
                    ? assigned
                      ? itemParticipants[index].join(' & ')
                      : 'Alex & Jamie'
                    : 'Quantity: 1'}
                </span>
              </div>
              <strong>{money(item.amount)}</strong>
              {itemized &&
                (index === 1 ? (
                  <Highlight activeFrom={local(4)} activeTo={openCoffeeAt - 1}>
                    <ActionCue at={openCoffeeAt}>
                      <UserPen />
                    </ActionCue>
                  </Highlight>
                ) : (
                  <UserPen />
                ))}
            </div>
          ))}
        </div>
        <div className="walkthrough-actions">
          <Highlight activeFrom={createAt - 40} activeTo={createAt + 10}>
            <ActionCue at={createAt}>
              <Button className="walkthrough-button">
                <Check />
                Create expense
              </Button>
            </ActionCue>
          </Highlight>
        </div>
      </UiFrame>
      {modal && (
        <div className="walkthrough-modal-backdrop">
          <UiFrame className="walkthrough-panel walkthrough-modal">
            <PanelTitle icon="edit">Coffee beans</PanelTitle>
            <p>1 × {money(receipt.items[1].amount)}</p>
            <h3>Split evenly between</h3>
            {participants.map((name) => {
              const row = (
                <div
                  className={`walkthrough-participant ${name === 'Alex' && draftAssigned ? 'unselected' : ''}`}
                >
                  <span className="walkthrough-avatar">
                    {name[0]}
                    {(name === 'Jamie' || !draftAssigned) && (
                      <span className="walkthrough-check-badge">
                        <Check />
                      </span>
                    )}
                  </span>
                  <strong>{name}</strong>
                </div>
              )
              return name === 'Alex' ? (
                <Highlight
                  key={name}
                  activeFrom={local(5) + 20}
                  activeTo={selectJamieAt + 20}
                >
                  <ActionCue at={selectJamieAt}>{row}</ActionCue>
                </Highlight>
              ) : (
                <div key={name}>{row}</div>
              )
            })}
            <div className="walkthrough-actions">
              <Highlight activeFrom={local(6)} activeTo={saveCoffeeAt + 10}>
                <ActionCue at={saveCoffeeAt}>
                  <Button className="walkthrough-button">
                    <Check />
                    Save changes
                  </Button>
                </ActionCue>
              </Highlight>
            </div>
          </UiFrame>
        </div>
      )}
    </Story>
  )
}
function SavedScene() {
  return (
    <Story
      step="05 / Shared expense"
      title="Scan the items. Choose who shares them."
    >
      <UiFrame className="walkthrough-panel walkthrough-saved">
        <div className="walkthrough-saved-heading">
          <span>
            <CheckCircle2 />
          </span>
          <div>
            <span>Expense created</span>
            <h2>{receipt.merchant}</h2>
          </div>
          <strong>{money(receipt.total)}</strong>
        </div>
        <ReceiptItems assigned />
        <div className="walkthrough-allocation-title">Paid for</div>
        <div className="walkthrough-allocations">
          {allocations.map(({ name, amount }) => (
            <div key={name}>
              <span className="walkthrough-avatar">{name[0]}</span>
              <strong>{name}</strong>
              <b>{money(amount)}</b>
            </div>
          ))}
        </div>
        <p className="walkthrough-saved-note">
          {receipt.group} · Receipt attached
        </p>
      </UiFrame>
    </Story>
  )
}
export function ReceiptWalkthrough({
  audioEnabled = true,
  soundDesignEnabled = true,
}: {
  audioEnabled?: boolean
  soundDesignEnabled?: boolean
}) {
  const frame = useCurrentFrame()
  const scenes = [
    {
      from: receiptTimeline[0].from,
      duration: receiptTimeline[0].durationInFrames,
      component: UploadScene,
    },
    {
      from: receiptTimeline[1].from,
      duration: receiptTimeline[1].durationInFrames,
      component: ScanScene,
    },
    {
      from: receiptTimeline[2].from,
      duration: receiptTimeline[2].durationInFrames,
      component: ReviewScene,
    },
    {
      from: receiptTimeline[3].from,
      duration: receiptTimeline[8].from - receiptTimeline[3].from,
      component: EditorScene,
    },
    {
      from: receiptTimeline[8].from,
      duration: receiptTimeline[8].durationInFrames,
      component: SavedScene,
    },
  ]
  return (
    <Canvas width={1600} height={900} className="receipt-walkthrough">
      <BrandHeader />
      {scenes.map(({ from, duration, component: Scene }) => (
        <Sequence key={from} from={from} durationInFrames={duration}>
          <Scene />
        </Sequence>
      ))}
      {audioEnabled && soundDesignEnabled && (
        <Audio src={staticFile('sound-design/receipt-walkthrough/mix.wav')} />
      )}
      {audioEnabled &&
        !soundDesignEnabled &&
        receiptTimeline.map((beat) => (
          <Sequence
            key={beat.id}
            from={beat.from + receiptStoryboard.leadFrames}
            durationInFrames={
              beat.durationInFrames - receiptStoryboard.leadFrames
            }
            layout="none"
          >
            <Audio
              src={staticFile(
                `narration/${receiptStoryboard.compositionId}/${beat.id}.wav`,
              )}
            />
          </Sequence>
        ))}
      <div className="walkthrough-progress">
        {['Upload', 'Extract', 'Review', 'Choose shares', 'Save'].map(
          (name, index) => (
            <div
              key={name}
              className={frame >= scenes[index].from ? 'reached' : ''}
            >
              <span>{index + 1}</span>
              {name}
            </div>
          ),
        )}
      </div>
    </Canvas>
  )
}

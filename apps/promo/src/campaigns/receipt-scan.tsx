import {
  ReceiptItemRow,
  ReceiptItemsShell,
} from '@web/app/groups/[groupId]/expenses/receipt-items-shell'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import {
  Check,
  FileText,
  List,
  Users,
  Split,
  Pencil,
  Receipt,
  ScanLine,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react'

import type { PromoSize } from '../catalog'
import {
  BrandHeader,
  Canvas,
  Connector,
  Headline,
  Metric,
  UiFrame,
} from '../primitives'
import { receipt, money, receiptDate } from './receipt-fixture'

function SpeedMetric({ compact = false }: { compact?: boolean }) {
  return (
    <Metric
      compact={compact}
      value={
        <>
          ~80s <span>→</span> ~14s
        </>
      }
      label="Typical scans · roughly 5× faster"
    />
  )
}

export function PaperReceipt({ className = '' }: { className?: string }) {
  return (
    <div
      className={`paper-receipt ${className}`}
      aria-label="Example grocery receipt"
    >
      <div className="receipt-store">
        FreshMart
        <br />
        Central
      </div>
      <p className="receipt-address">
        123 Market Street
        <br />
        October 12, 2026 · 10:42
      </p>
      <div className="receipt-rule" />
      <div className="receipt-lines">
        {receipt.items.map((item) => (
          <div key={item.title}>
            <span>{item.title}</span>
            <span>{money(item.amount)}</span>
          </div>
        ))}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-total">
        <strong>TOTAL</strong>
        <strong>{money(receipt.total)}</strong>
      </div>
      <p className="receipt-payment">
        CARD PAYMENT · USD
        <br />
        Thank you for shopping with us
      </p>
      <svg className="receipt-barcode" viewBox="0 0 230 45" aria-hidden="true">
        {Array.from({ length: 54 }, (_, index) => (
          <rect
            key={index}
            x={index * 4.2}
            y="0"
            width={index % 3 === 0 ? 2.8 : 1.3}
            height="40"
            fill="currentColor"
          />
        ))}
      </svg>
      <p className="receipt-number">RECEIPT 001284</p>
    </div>
  )
}

function PanelHeading({ mode }: { mode: 'upload' | 'review' }) {
  const Icon = mode === 'upload' ? ScanLine : Receipt
  return (
    <div className="panel-heading">
      <span className="panel-icon">
        <Icon aria-hidden="true" />
      </span>
      <h2>{mode === 'upload' ? 'Create from receipt' : 'Review AI expense'}</h2>
      <Badge variant="secondary" className="ai-badge">
        {mode === 'upload' && <Sparkles aria-hidden="true" />}AI
      </Badge>
      <X className="panel-close" aria-hidden="true" />
    </div>
  )
}

function ExpensePreview() {
  return (
    <UiFrame className="expense-preview expense-preview-compact sharing-preview">
      <PanelHeading mode="review" />
      <p className="panel-description">
        Review the scanned details before creating your expense.
      </p>
      <div className="expense-fields">
        <div className="field-wide">
          <span>Group</span>
          <strong>{receipt.group}</strong>
        </div>
        <div className="field-wide">
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
            <ShoppingCart aria-hidden="true" />
            Groceries
          </strong>
        </div>
        <div>
          <span>Split</span>
          <strong>Evenly across participants</strong>
        </div>
      </div>
      <div className="preview-items">
        <ReceiptItemsShell heading="Items">
          {receipt.items.map((item) => (
            <ReceiptItemRow
              key={item.title}
              title={item.title}
              amount={money(item.amount)}
            />
          ))}
        </ReceiptItemsShell>
      </div>
      <div className="preview-actions">
        <Button variant="outline">
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
        <Button>
          <Check aria-hidden="true" />
          Create expense
        </Button>
      </div>
    </UiFrame>
  )
}

function UploadPreview() {
  return (
    <UiFrame className="upload-preview">
      <PanelHeading mode="upload" />
      <p className="panel-description">
        Extract expense details from a receipt.
      </p>
      <p className="upload-hint">
        Upload a receipt photo or document. AI extracts the store, total, and
        line items.
      </p>
      <div className="translate-row">
        <span>
          <Check aria-hidden="true" />
        </span>
        Translate title and items to English
      </div>
      <Button variant="outline" className="scan-button">
        <ScanLine aria-hidden="true" />
        Scan receipt
      </Button>
    </UiFrame>
  )
}

function ScanningPreview() {
  return (
    <UiFrame className="scanning-preview">
      <div className="scanning-paper">
        <PaperReceipt />
      </div>
      <div className="scanning-overlay">
        <span className="scan-glow">
          <ScanLine aria-hidden="true" />
          <Sparkles className="scan-sparkles" aria-hidden="true" />
        </span>
        <strong>Reading your receipt…</strong>
        <p>
          Extracting the total
          <br />
          and line items.
        </p>
      </div>
    </UiFrame>
  )
}

/** One combined story: receipt scan → itemized expense → user-chosen splits. */
export function ReceiptPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="receipt-promo">
      <BrandHeader version="v2.7.0" />
      <div className="combined-headline">
        <Headline
          subtitle={
            <>
              Share shopping with friends & family.
              <br />
              Edit the expense to split individual items.
            </>
          }
        >
          Scan receipts into
          <br />
          <span className="headline-accent">itemized shared expenses.</span>
        </Headline>
      </div>
      <div className="combined-upload">
        <div className="combined-paper">
          <PaperReceipt />
        </div>
        <div className="combined-upload-panel">
          <div className="stage-label">
            <span>1</span>Upload a receipt
          </div>
          <UploadPreview />
        </div>
      </div>
      <div className="combined-first-arrow">
        <Connector />
      </div>
      <div className="combined-scan">
        <div className="combined-speed">
          <SpeedMetric compact />
        </div>
        <div className="stage-label">
          <span>2</span>AI scans the items
        </div>
        <ScanningPreview />
      </div>
      <div className="combined-second-arrow">
        <Connector />
      </div>
      <div className="combined-result">
        <div className="stage-label">
          <span>3</span>Review, then edit to split
        </div>
        <ExpensePreview />
      </div>
      <footer className="combined-benefits">
        <div>
          <span className="benefit-icon">
            <Users aria-hidden="true" />
          </span>
          <div>
            <strong>Friends & family</strong>
            <p>Share groceries, meals & more.</p>
          </div>
        </div>
        <div>
          <span className="benefit-icon">
            <List aria-hidden="true" />
          </span>
          <div>
            <strong>Detailed itemized expenses</strong>
            <p>Keep the scanned receipt items.</p>
          </div>
        </div>
        <div>
          <span className="benefit-icon">
            <Split aria-hidden="true" />
          </span>
          <div>
            <strong>Flexible per-item splits</strong>
            <p>Set item splits in the expense editor.</p>
          </div>
        </div>
        <div>
          <span className="benefit-icon">
            <FileText aria-hidden="true" />
          </span>
          <div>
            <strong>Photos, PDFs & docs</strong>
            <p>JPG, PNG, PDF, TXT, CSV, DOCX, ODT.</p>
          </div>
        </div>
      </footer>
    </Canvas>
  )
}

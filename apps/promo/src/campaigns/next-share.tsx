import { Button } from '@web/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card'
import { Input } from '@web/components/ui/input'
import {
  ArrowRight,
  Check,
  Copy,
  FileText,
  Images,
  Mail,
  MessageCircle,
  Paperclip,
  ScanLine,
  Search,
  Share,
  Trash2,
  Upload,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas } from '../primitives'

import './next-release.css'

/**
 * Share story as a 3-step flow:
 *
 * 1. Imaginary Gallery app holding receipt.jpg (generic mock, not app UI).
 * 2. Generic Android share sheet with Spliit Cloud as the target.
 * 3. Real Spliit Cloud `/share-target` Cards in a phone mockup — static,
 *    pixel-faithful copies (same classNames, fixed English from
 *    en-US.json:ShareTarget). Static copies because the real page needs
 *    IDB/TRPC/router hooks.
 */

function FaithfulStagedFile() {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border p-2',
        'border-primary ring-1 ring-primary',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-start"
        aria-pressed
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            receipt.jpg
          </span>
          <span className="block text-xs text-muted-foreground">2.1 MB</span>
        </span>
        <Check className="ms-auto h-4 w-4 shrink-0 text-primary" />
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove file"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  )
}

function FaithfulGroupButton({
  name,
  kind,
  selected,
}: {
  name: string
  kind: string
  selected?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition-colors hover:bg-accent',
          selected && 'border-primary ring-1 ring-primary',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{kind}</span>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    </li>
  )
}

function ImaginaryGalleryApp() {
  return (
    <div className="next-source-app">
      <div className="next-source-top">
        <span className="next-source-appname">
          <Images aria-hidden="true" />
          Gallery
        </span>
        <span className="next-source-date">Lisbon · Oct 2026</span>
      </div>
      <div className="next-source-photo">
        <div className="next-source-receipt">
          <p className="next-source-receipt-title">IZAKAYA LISBOA</p>
          <p>Ramen x2 · €24.00</p>
          <p>Edamame · €6.20</p>
          <p>Tea x2 · €8.00</p>
          <p className="next-source-receipt-total">Total €48.20</p>
          <p className="next-source-filename">receipt.jpg · 2.1 MB</p>
        </div>
      </div>
      <div className="next-source-bar">
        <span className="next-source-bar-label">1 photo selected</span>
        <span className="next-source-share">
          <Share aria-hidden="true" />
          Share
        </span>
      </div>
    </div>
  )
}

function ShareSheetMock() {
  return (
    <div className="next-sheet">
      <p className="next-sheet-title">Share receipt.jpg</p>
      <ul className="next-sheet-rows">
        <li>
          <Copy aria-hidden="true" />
          Copy
        </li>
        <li>
          <MessageCircle aria-hidden="true" />
          Messages
        </li>
        <li>
          <Mail aria-hidden="true" />
          Mail
        </li>
        <li className="next-sheet-target">
          <span className="next-sheet-logo" aria-hidden="true">
            S
          </span>
          <span className="next-sheet-target-text">
            <strong>Spliit Cloud</strong>
            <span>Add shared content</span>
          </span>
          <Check aria-hidden="true" />
        </li>
      </ul>
    </div>
  )
}

function PhoneShareScreen() {
  return (
    <div className="next-phone-screen">
      <p className="next-phone-title">
        <Share aria-hidden="true" />
        Add shared content
      </p>
      <Card className="next-phone-card">
        <CardHeader>
          <CardTitle>Shared files</CardTitle>
          <CardDescription>
            Files shared from another app appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            <FaithfulStagedFile />
          </ul>
          <div>
            <Button type="button" variant="outline" size="sm">
              <Paperclip className="me-2 h-4 w-4" />
              Choose file
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="next-phone-card">
        <CardHeader>
          <CardTitle>Pick a group</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:rotate-180" />
            <Input
              value=""
              placeholder="Search groups and friends"
              className="ps-9"
              aria-label="Search groups and friends"
              readOnly
            />
          </div>
          <ul className="grid gap-2">
            <FaithfulGroupButton name="Lisbon trip" kind="Groups" selected />
            <FaithfulGroupButton name="Alex" kind="Friends" />
          </ul>
        </CardContent>
      </Card>
      <Card className="next-phone-card">
        <CardHeader>
          <CardTitle>Lisbon trip</CardTitle>
          <CardDescription>
            Pick how to turn the selected file into an expense.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button type="button" size="sm">
            <ScanLine className="me-2 h-4 w-4" />
            Scan with AI
          </Button>
          <Button type="button" variant="secondary" size="sm">
            <Upload className="me-2 h-4 w-4" />
            Create expense with attachment
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function NextSharePromo(size: PromoSize) {
  return (
    <Canvas {...size} className="next-promo next-share">
      <BrandHeader />
      <div className="next-share-head">
        <h1>
          Share receipts <em>straight to Spliit Cloud.</em>
        </h1>
        <p>
          Snap a receipt in Gallery → Share → Spliit Cloud → pick Lisbon trip →
          scan it with AI.
        </p>
        <div className="next-share-flow">
          <div className="next-flow-step">
            <ImaginaryGalleryApp />
            <p className="next-flow-label">
              <strong>1 · Gallery</strong> Tap Share on receipt.jpg
            </p>
          </div>
          <ArrowRight aria-hidden="true" className="next-flow-arrow" />
          <div className="next-flow-step">
            <ShareSheetMock />
            <p className="next-flow-label">
              <strong>2 · Share sheet</strong> Pick Spliit Cloud
            </p>
          </div>
        </div>
        <p className="next-clarification">
          Shared text lands as a note the same way. Up to 10 files, 2 MB each.
        </p>
        <p className="next-location">
          <strong>Share → Spliit Cloud</strong> · Gallery (imaginary) → Android
          sheet → share-target screen
        </p>
      </div>
      <div className="next-phone-wrap">
        <p className="next-phone-hint">
          <Share aria-hidden="true" />3 · Spliit Cloud picks group → scans
        </p>
        <div className="next-phone">
          <span className="next-phone-notch" aria-hidden="true" />
          <PhoneShareScreen />
        </div>
      </div>
    </Canvas>
  )
}

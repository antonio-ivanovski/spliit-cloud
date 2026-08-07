import { Loader2, Mic, RotateCcw, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { CategoryId } from '@spliit/domain'

import { useCurrentGroupOrNull } from '../current-group-context'
import { AiCaptureDialog } from './ai-capture-dialog'
import { AiExpensePreview, type AiExpenseDraft } from './ai-expense-preview'

const MAX_RECORDING_SECONDS = 30

type Props = {
  className?: string
  iconOnly?: boolean
  responsive?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onFlowActiveChange?: (active: boolean) => void
  hideTrigger?: boolean
}

type RecorderState = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const targetRate = 16_000
  const ratio = sampleRate / targetRate
  const outputLength = Math.max(1, Math.floor(samples.length / ratio))
  const buffer = new ArrayBuffer(44 + outputLength * 2)
  const view = new DataView(buffer)
  const writeString = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(at + index, value.charCodeAt(index))
    }
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + outputLength * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, outputLength * 2, true)
  for (let index = 0; index < outputLength; index++) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(index * ratio))
    const sample = Math.max(-1, Math.min(1, samples[sourceIndex] ?? 0))
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    )
  }
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

async function normalizeAudio(blob: Blob) {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    return encodeWav(
      new Float32Array(decoded.getChannelData(0)),
      decoded.sampleRate,
    )
  } finally {
    await context.close()
  }
}

function readAudioMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export function VoiceExpenseButton({
  className,
  iconOnly = false,
  responsive = false,
  open: openProp,
  onOpenChange,
  onFlowActiveChange,
  hideTrigger = false,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AIExpense' })
  const locale = useLocale()
  const currentGroup = useCurrentGroupOrNull()
  const { toast } = useToast()
  const [internalOpen, setInternalOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<AudioResult | null>(null)
  const [preview, setPreview] = useState<AiExpenseDraft | null>(null)
  const recorderRef = useRef<RecorderState | null>(null)
  const timerRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const flowActiveRef = useRef(false)
  const extractMutation =
    trpc.ai.extractExpenseInformationFromAudio.useMutation()
  const open = openProp ?? internalOpen
  const setFlowActive = useCallback(
    (active: boolean) => {
      flowActiveRef.current = active
      onFlowActiveChange?.(active)
    },
    [onFlowActiveChange],
  )
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen)
      setFlowActive(nextOpen || flowActiveRef.current)
    },
    [onOpenChange, openProp, setFlowActive],
  )

  const effectiveGroup = currentGroup?.group
  const effectiveParticipantId = currentGroup?.currentLedgerParticipantId

  const clearTimer = () => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  const cleanupRecorder = () => {
    const state = recorderRef.current
    recorderRef.current = null
    if (!state) return
    state.stream.getTracks().forEach((track) => track.stop())
  }

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      clearTimer()
      cleanupRecorder()
    }
  }, [])

  const processAudio = async (dataUrl: string) => {
    if (!currentGroup) return
    const requestId = ++requestIdRef.current
    setProcessing(true)
    try {
      const response = await extractMutation.mutateAsync({
        audioDataUrl: dataUrl,
        groupId: currentGroup.groupId,
        locale,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      })
      if (requestId !== requestIdRef.current) return
      setResult(response)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      console.error(error)
      setResult(null)
      toast({ description: t('processingError'), variant: 'destructive' })
    } finally {
      if (requestId === requestIdRef.current) setProcessing(false)
    }
  }

  const finishRecording = async () => {
    const state = recorderRef.current
    if (!state) return
    const recordingRequestId = requestIdRef.current
    clearTimer()
    setRecording(false)
    cleanupRecorder()
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType })
    try {
      const dataUrl = await normalizeAudio(blob)
      if (recordingRequestId !== requestIdRef.current) return
      await processAudio(dataUrl)
    } catch (error) {
      console.error(error)
      toast({ description: t('audioError'), variant: 'destructive' })
    }
  }

  const startRecording = async () => {
    setResult(null)
    setPreview(null)
    setElapsed(0)
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('Media recording is unavailable')
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = readAudioMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      )
      const state: RecorderState = { recorder, stream, chunks: [] }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) state.chunks.push(event.data)
      }
      recorder.onstop = () => void finishRecording()
      recorderRef.current = state
      recorder.start()
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        setElapsed((value) => {
          const next = value + 1
          if (next >= MAX_RECORDING_SECONDS) {
            clearTimer()
            if (recorder.state === 'recording') recorder.stop()
          }
          return next
        })
      }, 1000)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      console.error(error)
      toast({ description: t('microphoneError'), variant: 'destructive' })
    }
  }

  const close = () => {
    requestIdRef.current += 1
    clearTimer()
    if (recorderRef.current?.recorder.state === 'recording') {
      recorderRef.current.recorder.stop()
    }
    cleanupRecorder()
    setRecording(false)
    setProcessing(false)
    setResult(null)
    setPreview(null)
    setOpen(false)
    setFlowActive(false)
  }

  useEffect(() => {
    if (processing || !result || !effectiveGroup) return
    flowActiveRef.current = true
    // oxlint-disable-next-line react/react-compiler -- open the review dialog after extraction resolves.
    setPreview({
      source: 'voice',
      transcript: result.transcript,
      title: result.title,
      amount: result.amount,
      amountUnit: 'major',
      currencyCode: result.currencyCode,
      date: result.date,
      categoryId: result.categoryId,
      payerParticipantId: result.payerParticipantId,
      participantIds: result.participantIds,
      issues: result.issues,
    })
    setOpen(false)
    setFlowActive(true)
  }, [effectiveGroup, processing, result, setOpen, setFlowActive])

  const alwaysIconOnly = iconOnly && !responsive
  const responsiveIconOnly = iconOnly && responsive
  const showText = !alwaysIconOnly

  if (!currentGroup || currentGroup.currentInvitation) return null

  return (
    <>
      <AiCaptureDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        icon={Mic}
        title={t('voiceTitle')}
        description={t('voiceDescription')}
        trigger={
          hideTrigger ? undefined : (
            <Button
              type="button"
              variant="secondary"
              size={alwaysIconOnly ? 'icon' : 'default'}
              className={cn(
                responsiveIconOnly &&
                  'h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-4 sm:py-2',
                className,
              )}
              disabled={processing}
              title={t('voiceAction')}
              aria-label={t('voiceAction')}
            >
              <Mic className={showText ? 'me-2 size-5 sm:size-4' : 'size-6'} />
              {showText && (
                <span
                  className={
                    responsiveIconOnly ? 'hidden sm:inline' : undefined
                  }
                >
                  {t('voiceAction')}
                </span>
              )}
            </Button>
          )
        }
        footer={
          result && !processing && !preview ? (
            <Button
              type="button"
              variant="ghost"
              className="mx-auto"
              onClick={() => {
                setResult(null)
              }}
            >
              <RotateCcw className="me-2 size-4" />
              {t('recordAgain')}
            </Button>
          ) : null
        }
      >
        {!result ? (
          <div className="rounded-xl border bg-muted/20 p-6 text-center">
            <div
              className={`mx-auto flex size-20 items-center justify-center rounded-full ${recording ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}
            >
              {recording ? (
                <span className="text-xl font-semibold tabular-nums">
                  {elapsed}s
                </span>
              ) : (
                <Mic className="size-8" />
              )}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {recording ? t('recording') : t('voiceDescription')}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {recording ? (
                <Button
                  type="button"
                  onClick={() => recorderRef.current?.recorder.stop()}
                >
                  <Square className="me-2 size-4" />
                  {t('stop')}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="me-2 size-4 animate-spin" />
                  ) : (
                    <Mic className="me-2 size-4" />
                  )}
                  {processing ? t('processing') : t('record')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              {t('processing')}
            </div>
          </div>
        )}
      </AiCaptureDialog>
      {preview && effectiveGroup && (
        <AiExpensePreview
          open
          onOpenChange={(next) => {
            if (!next) {
              setPreview(null)
              setResult(null)
              setFlowActive(false)
            }
          }}
          group={effectiveGroup}
          currentLedgerParticipantId={effectiveParticipantId}
          draft={preview}
        />
      )}
    </>
  )
}

type AudioResult = {
  transcript: string | null
  title: string | null
  amount: string | null
  currencyCode: string | null
  date: string | null
  categoryId: CategoryId | null
  payerParticipantId: string | null
  participantIds: string[]
  issues: AudioIssue[]
}

type AudioIssue =
  | 'missingTitle'
  | 'missingAmount'
  | 'invalidDate'
  | 'unsupportedCurrency'

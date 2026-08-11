import { createHash } from 'node:crypto'

import { AsyncZipDeflate, Zip, strToU8 } from 'fflate'

import type {
  ExportArchiveEntry,
  ExportBundleDocument,
  ExportDocumentReader,
} from './types'

function addZipEntry(zip: Zip, path: string, bytes: Uint8Array) {
  const entry = new AsyncZipDeflate(path, { level: 6 })
  zip.add(entry)
  entry.push(bytes, true)
}

function assertArchivePath(path: string): void {
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid export archive path: ${path}`)
  }
}

function normalizeArchivePrefix(prefix: string): string {
  const normalized = prefix.replace(/^\/+|\/+$/g, '')
  if (normalized) assertArchivePath(normalized)
  return normalized
}

function withArchivePrefix(path: string, prefix: string): string {
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}/${path}`
}

function compareArchivePath(
  left: ExportArchiveEntry,
  right: ExportArchiveEntry,
) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

function cancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error('Export cancelled')
}

export function createExportBundleStream<Manifest>(options: {
  manifest: Manifest
  documents: ReadonlyArray<ExportBundleDocument>
  documentReader: ExportDocumentReader
  validateManifest(manifest: Manifest): Manifest
  additionalEntries?: ReadonlyArray<ExportArchiveEntry>
  /** Namespace all entries for a reusable group slice in an account archive. */
  archivePrefix?: string
  /** Override the manifest location; defaults to `<prefix>/manifest.json`. */
  manifestPath?: string
  signal?: AbortSignal
}): ReadableStream<Uint8Array> {
  let cancelled = false
  let settled = false
  let zip: Zip | undefined
  let zipEnded = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
  let demandResolver: (() => void) | undefined
  const documentAbort = new AbortController()

  const wakeProducer = () => {
    const resolve = demandResolver
    demandResolver = undefined
    resolve?.()
  }

  const removeExternalAbortListener = () => {
    options.signal?.removeEventListener('abort', onExternalAbort)
  }

  const endZip = () => {
    if (zipEnded) return
    zipEnded = true
    zip?.end()
  }

  const stop = (reportError: boolean) => {
    if (cancelled || settled) return
    cancelled = true
    documentAbort.abort(options.signal?.reason)
    wakeProducer()
    removeExternalAbortListener()
    try {
      endZip()
    } catch {
      // A cancelled consumer has no remaining ZIP output to receive.
    }
    if (reportError && controllerRef) {
      settled = true
      controllerRef.error(cancellationError(options.signal))
    }
  }

  const onExternalAbort = () => stop(true)

  const waitForDemand = async () => {
    if (cancelled || (controllerRef?.desiredSize ?? 1) > 0) return
    await new Promise<void>((resolve) => {
      demandResolver = resolve
    })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      if (options.signal?.aborted) {
        stop(true)
        return
      }
      options.signal?.addEventListener('abort', onExternalAbort, { once: true })

      zip = new Zip((error, data, final) => {
        if (cancelled || settled) return
        if (error) {
          settled = true
          removeExternalAbortListener()
          controller.error(error)
          return
        }
        controller.enqueue(data)
        if (final) {
          settled = true
          removeExternalAbortListener()
          controller.close()
        }
      })

      void (async () => {
        const archivePrefix = normalizeArchivePrefix(
          options.archivePrefix ?? '',
        )
        const manifestPath =
          options.manifestPath ??
          withArchivePrefix('manifest.json', archivePrefix)
        assertArchivePath(manifestPath)
        const usedPaths = new Set([manifestPath])
        for (const document of options.documents) {
          if (!document.entry.path) continue
          document.entry.path = withArchivePrefix(
            document.entry.path,
            archivePrefix,
          )
          assertArchivePath(document.entry.path)
          if (usedPaths.has(document.entry.path)) {
            throw new Error(
              `Duplicate export archive path: ${document.entry.path}`,
            )
          }
          usedPaths.add(document.entry.path)
        }

        const additionalEntries = [...(options.additionalEntries ?? [])]
          .map((entry) => ({
            ...entry,
            path: withArchivePrefix(entry.path, archivePrefix),
          }))
          .sort(compareArchivePath)
        for (const entry of additionalEntries) {
          assertArchivePath(entry.path)
          if (usedPaths.has(entry.path)) {
            throw new Error(`Duplicate export archive path: ${entry.path}`)
          }
          usedPaths.add(entry.path)
        }

        for (const document of options.documents) {
          if (cancelled) return
          const intendedPath = document.entry.path
          if (!intendedPath) continue
          try {
            const bytes = await options.documentReader.read(
              document.record,
              documentAbort.signal,
            )
            if (cancelled) return
            const hash = createHash('sha256').update(bytes).digest('hex')
            const sizeBytes = bytes.byteLength
            addZipEntry(zip!, intendedPath, bytes)
            document.entry.status = 'INCLUDED'
            document.entry.sizeBytes = sizeBytes
            document.entry.sha256 = hash
          } catch {
            if (cancelled) return
            document.entry.path = null
            document.markMissing(intendedPath)
          }
          await Promise.resolve()
          await waitForDemand()
        }

        for (const entry of additionalEntries) {
          if (cancelled) return
          addZipEntry(zip!, entry.path, entry.bytes)
          await Promise.resolve()
          await waitForDemand()
        }

        if (cancelled) return
        const manifest = options.validateManifest(options.manifest)
        addZipEntry(
          zip!,
          manifestPath,
          strToU8(JSON.stringify(manifest, null, 2)),
        )
        endZip()
      })().catch((error) => {
        if (cancelled || settled) return
        settled = true
        removeExternalAbortListener()
        controller.error(error)
      })
    },
    pull() {
      wakeProducer()
    },
    cancel() {
      stop(false)
    },
  })
}

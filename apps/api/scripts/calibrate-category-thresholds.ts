/**
 * ONE-TIME calibration script for category thresholds. Not covered by tests,
 * not prod-grade — delete or rewrite if it ever needs to run regularly.
 *
 * Replays Main-dump.csv (prod Expense export) through the real local matcher
 * and, in phase 2, through the live Jev decision model.
 *
 * Usage (from apps/api): bun run scripts/calibrate-category-thresholds.ts
 * --csv=../../Main-dump.csv --phase=1 --limit=500 TYPESAFE_CALIB_API_KEY=xxx
 * bun run scripts/calibrate-category-thresholds.ts --csv=../../Main-dump.csv
 * --phase=2
 *
 * Flags: --csv (required), --phase=1|2|blind|all (default all), --limit=N
 * (first N expenses only, for smoke tests), --ledgers=id1,id2, --out=dir
 * (default ../../calibration-out), --concurrency=N (default 8), --model=name
 * (default jev-latest), --timeout=N (seconds, default 15)
 *
 * The API key is read ONLY from TYPESAFE_CALIB_API_KEY and never printed,
 * logged, or written to disk. Rotate it after the run.
 */

import {
  mkdirSync,
  appendFileSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  categoryIdSchema,
  isSettlementCategory,
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  suggestCategoryFromTitleForLocale,
  type CategoryId,
} from '@spliit/domain'

import { suggestCategoryWithSystemOne } from '../src/lib/ai/system-one-categorize'

const LOCALE = 'en-US'
const GENERAL = 'general'

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit?.slice(prefix.length)
}

const csvPath = flag('csv')
if (!csvPath) throw new Error('Missing required --csv=path/to/Main-dump.csv')
const phase = flag('phase') ?? 'all'
const limit = flag('limit') ? Number(flag('limit')) : Number.POSITIVE_INFINITY
const ledgerFilter = new Set(
  (flag('ledgers') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const outDir =
  flag('out') ??
  join(new URL('../../..', import.meta.url).pathname, 'calibration-out')
const concurrency = Number(flag('concurrency') ?? 8)
const model = flag('model') ?? 'jev-latest'
const timeoutSeconds = Number(flag('timeout') ?? 15)
const apiKey = process.env['TYPESAFE_CALIB_API_KEY']
if ((phase === '2' || phase === 'blind' || phase === 'all') && !apiKey) {
  throw new Error('Set TYPESAFE_CALIB_API_KEY env var for live Jev phases')
}

mkdirSync(outDir, { recursive: true })

// --- minimal CSV parser (handles quoted commas, escaped quotes, newlines) ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

type DumpRow = {
  ledgerId: string
  groupName: string | null
  expenseId: string
  title: string
  stored: string
  seq: number
}

async function loadDump(): Promise<DumpRow[]> {
  const text = await readFile(csvPath!, 'utf8')
  const rows = parseCsv(text)
  const header = rows[0]!
  const idx = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`CSV missing column ${name}`)
    return i
  }
  const c = {
    ledger: idx('ledger_id'),
    group: idx('group_name'),
    id: idx('expense_id'),
    title: idx('title'),
    cat: idx('category_id'),
    seq: idx('ledger_seq'),
  }
  const out: DumpRow[] = []
  for (const r of rows.slice(1)) {
    if (r.length < header.length) continue
    const ledgerId = r[c.ledger]!
    if (ledgerFilter.size > 0 && !ledgerFilter.has(ledgerId)) continue
    out.push({
      ledgerId,
      groupName: r[c.group]! || null,
      expenseId: r[c.id]!,
      title: r[c.title]!,
      stored: r[c.cat]!,
      seq: Number(r[c.seq]!),
    })
    if (out.length >= limit) break
  }
  out.sort((a, b) =>
    a.ledgerId < b.ledgerId ? -1 : a.ledgerId > b.ledgerId ? 1 : a.seq - b.seq,
  )
  return out
}

function asCategoryId(value: string): CategoryId | null {
  const parsed = categoryIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

type Memory = { title: string; categoryId: string }[]

// Mirror of the server cascade in suggest-category.ts / suggest.ts (updated for
// the dictionary veto: a >=0.9 non-settlement dictionary hit overrules exact
// history on disagreement): dictionary hit first, then history (exact>=2 wins;
// lone exact defers to a confident dictionary disagreement; fuzzy needs >=2),
// settlement lone/fuzzy history never wins. `historyKind` is decoded from the
// history score (1 = exact>=2, 0.85 = lone exact, 0.75 = fuzzy>=2).
function combine(
  dictId: CategoryId | null,
  dictScore: number | null,
  historyId: CategoryId | null,
  historyScore: number | null,
): CategoryId | null {
  if (historyId && historyScore === 1) {
    if (
      dictId &&
      (dictScore ?? 0) >= 0.9 &&
      dictId !== historyId &&
      !isSettlementCategory(dictId)
    ) {
      return dictId
    }
    return historyId
  }
  if (historyId && historyScore === 0.85 && !isSettlementCategory(historyId)) {
    if (!dictId || dictId === historyId) return historyId
    return dictId
  }
  if (dictId) return dictId
  if (historyId && historyScore === 0.75 && !isSettlementCategory(historyId)) {
    return historyId
  }
  return null
}

// --- phase 1: local threshold sweep (minScore x settlementMinScore; the
// dictionary stage has no margin gate — ties simply go to the top hit) ---
const MIN_SCORES = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
const SETTLE_SCORES = [0.9, 0.95, 0.98]

function bucket(ledgerSize: number): string {
  if (ledgerSize < 5) return '<5'
  if (ledgerSize < 20) return '5-19'
  if (ledgerSize < 100) return '20-99'
  return '100+'
}

async function phase1(rows: DumpRow[]) {
  console.log(
    `Phase 1: sweeping ${rows.length} expenses over ${MIN_SCORES.length * SETTLE_SCORES.length} combos`,
  )
  const started = Date.now()
  const ledgers = new Map<string, DumpRow[]>()
  for (const r of rows) {
    const list = ledgers.get(r.ledgerId) ?? []
    list.push(r)
    ledgers.set(r.ledgerId, list)
  }

  // Per-combo accumulators
  type Acc = {
    fired: number
    correct: number
    scored: number
    generalFired: number
    generalTotal: number
    coverageByBucket: Record<string, number>
    totalByBucket: Record<string, number>
  }
  const accs = new Map<string, Acc>()
  const key = (m: number, s: number) => `${m}|${s}`
  for (const m of MIN_SCORES)
    for (const s of SETTLE_SCORES) {
      accs.set(key(m, s), {
        fired: 0,
        correct: 0,
        scored: 0,
        generalFired: 0,
        generalTotal: 0,
        coverageByBucket: {},
        totalByBucket: {},
      })
    }

  // Dictionary hits memoized per (title, combo) — memory-independent.
  const dictMemo = new Map<string, { id: CategoryId; score: number } | null>()
  const disagreements: string[] = ['expense_id,title,stored,predicted']
  let processed = 0

  for (const list of ledgers.values()) {
    const b = bucket(list.length)
    const memory: Memory = []
    for (const r of list) {
      const okLength = meetsCategorySuggestMinQueryLength(r.title)
      const historyHit =
        okLength && memory.length > 0
          ? suggestCategoryFromTitleForLocale(r.title, LOCALE, memory, {
              dictionaryEnabled: false,
              historyEnabled: true,
            })
          : null
      const historyId = historyHit ? asCategoryId(historyHit.id) : null
      const storedId = asCategoryId(r.stored)
      for (const m of MIN_SCORES)
        for (const s of SETTLE_SCORES) {
          const acc = accs.get(key(m, s))!
          acc.totalByBucket[b] = (acc.totalByBucket[b] ?? 0) + 1
          let predicted: CategoryId | null = null
          if (okLength) {
            const memoKey = `${m}|${s}::${r.title}`
            let dictHit: { id: CategoryId; score: number } | null | undefined =
              dictMemo.get(memoKey)
            if (dictHit === undefined) {
              const hit = suggestCategoryFromTitleForLocale(
                r.title,
                LOCALE,
                [],
                {
                  dictionaryEnabled: true,
                  historyEnabled: false,
                  thresholds: { minScore: m, settlementMinScore: s },
                },
              )
              dictHit = hit ? { id: hit.id, score: hit.score } : null
              dictMemo.set(memoKey, dictHit)
            }
            predicted = combine(
              dictHit?.id ?? null,
              dictHit?.score ?? null,
              historyId,
              historyHit?.score ?? null,
            )
          }
          if (predicted) {
            acc.fired++
            acc.coverageByBucket[b] = (acc.coverageByBucket[b] ?? 0) + 1
            if (r.stored === GENERAL) {
              acc.generalFired++
              acc.generalTotal++
              if (m === 0.7 && s === 0.95 && disagreements.length < 2000) {
                disagreements.push(
                  `${r.expenseId},"${r.title.replaceAll('"', '""')}",general,${predicted}`,
                )
              }
            } else if (storedId) {
              acc.scored++
              if (predicted === storedId) acc.correct++
              else if (m === 0.7 && s === 0.95 && disagreements.length < 2000) {
                disagreements.push(
                  `${r.expenseId},"${r.title.replaceAll('"', '""')}",${r.stored},${predicted}`,
                )
              }
            }
          } else if (r.stored === GENERAL) {
            acc.generalTotal++
          }
        }
      // Memory mirrors the server: exclude general/settlement, cap 200.
      if (storedId && r.stored !== GENERAL && !isSettlementCategory(storedId)) {
        memory.push({ title: r.title, categoryId: r.stored })
        if (memory.length > 200) memory.shift()
      }
      if (++processed % 5000 === 0)
        console.log(`  ...${processed}/${rows.length}`)
    }
  }

  const lines = [
    'min_score,settlement_min,coverage,precision,scored,general_fire_rate,coverage_<5,coverage_5-19,coverage_20-99,coverage_100+',
  ]
  let best: { m: number; s: number } | null = null
  // Strictest combo (highest min, then highest settlement) with precision >= 0.95.
  const ordered = [...MIN_SCORES]
    .sort((a, b) => b - a)
    .flatMap((m) =>
      [...SETTLE_SCORES].sort((a, b) => b - a).map((s) => ({ m, s })),
    )
  for (const m of MIN_SCORES)
    for (const s of SETTLE_SCORES) {
      const a = accs.get(key(m, s))!
      const coverage = a.fired / rows.length
      const precision = a.scored > 0 ? a.correct / a.scored : 0
      const generalFire =
        a.generalTotal > 0 ? a.generalFired / a.generalTotal : 0
      const cov = (k: string) =>
        (
          (a.coverageByBucket[k] ?? 0) / Math.max(1, a.totalByBucket[k] ?? 0)
        ).toFixed(3)
      lines.push(
        `${m},${s},${coverage.toFixed(4)},${precision.toFixed(4)},${a.scored},${generalFire.toFixed(4)},${cov('<5')},${cov('5-19')},${cov('20-99')},${cov('100+')}`,
      )
    }
  for (const c of ordered) {
    const a = accs.get(key(c.m, c.s))!
    if (a.scored >= 50 && a.correct / a.scored >= 0.95) {
      best = c
      break
    }
  }
  writeFileSync(join(outDir, 'phase1_table.csv'), lines.join('\n') + '\n')
  writeFileSync(
    join(outDir, 'disagreements_phase1.csv'),
    disagreements.join('\n') + '\n',
  )
  const rec = best
    ? `Recommended local gates (>=95% precision, strictest):\nCATEGORY_LOCAL_MIN_SCORE=${best.m}\nCATEGORY_LOCAL_SETTLEMENT_MIN_SCORE=${best.s}\n`
    : 'No combo reached >=95% precision with >=50 scored samples — inspect phase1_table.csv.\n'
  writeFileSync(join(outDir, 'phase1_recommendation.txt'), rec)
  console.log(rec.trim())
  console.log(
    `Phase 1 done in ${((Date.now() - started) / 1000).toFixed(0)}s → ${outDir}`,
  )
  return best
}

// --- phase 2 + blind: live Jev ---
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callJev(
  title: string,
  recent: Memory,
  groupName: string | null,
  blind: boolean,
): Promise<{
  jevId: string
  confidence: number
  margin: number
  error: string
}> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await suggestCategoryWithSystemOne(title, {
        apiKey: apiKey!,
        model,
        timeoutSeconds,
        minConfidence: 0, // raw verdicts; the floor is decided analytically
        recentExpenses: blind ? [] : recent.slice(-50),
        locale: LOCALE,
        groupContext:
          !blind && groupName
            ? { name: groupName, currency: '', currencyCode: null }
            : undefined,
      })
      return {
        jevId: res.categoryId ?? '',
        confidence: res.confidence,
        margin: res.marginTopTwo,
        error: '',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const retryable = /429|5\d\d|timeout|timed out|fetch failed/i.test(
        message,
      )
      if (retryable && attempt < 2) {
        await sleep(3000)
        continue
      }
      return {
        jevId: '',
        confidence: 0,
        margin: 0,
        error: message.slice(0, 200),
      }
    }
  }
  return { jevId: '', confidence: 0, margin: 0, error: 'retries exhausted' }
}

function loadDoneIds(file: string): Set<string> {
  if (!existsSync(file)) return new Set()
  const lines = parseCsvSync(file)
  const done = new Set<string>()
  for (const parts of lines.slice(1)) if (parts[0]) done.add(parts[0]!)
  return done
}

// sync read helper (results files are small relative to dump)
function parseCsvSync(file: string): string[][] {
  return parseCsv(readFileSync(file, 'utf8'))
}

const JEV_HEADER = 'expense_id,title,stored,jev_id,confidence,margin,mode,error'

async function runJevPass(
  rows: DumpRow[],
  mode: 'history' | 'blind',
  onlyIds?: Set<string>,
) {
  const file = join(
    outDir,
    mode === 'blind' ? 'blind_results.csv' : 'jev_results.csv',
  )
  if (!existsSync(file)) writeFileSync(file, JEV_HEADER + '\n')
  const done = loadDoneIds(file)
  const todo = rows.filter(
    (r) => !done.has(r.expenseId) && (!onlyIds || onlyIds.has(r.expenseId)),
  )
  console.log(
    `Jev ${mode}: ${todo.length} to call (${done.size} already done), concurrency ${concurrency}`,
  )
  const ledgers = new Map<string, DumpRow[]>()
  for (const r of rows) {
    const list = ledgers.get(r.ledgerId) ?? []
    list.push(r)
    ledgers.set(r.ledgerId, list)
  }
  // Precompute per-expense memory from the full dump (not just todo).
  const memoryByExpense = new Map<string, Memory>()
  for (const list of ledgers.values()) {
    const memory: Memory = []
    for (const r of list) {
      memoryByExpense.set(r.expenseId, [...memory])
      const storedId = asCategoryId(r.stored)
      if (storedId && r.stored !== GENERAL && !isSettlementCategory(storedId)) {
        memory.push({ title: r.title, categoryId: r.stored })
        if (memory.length > 200) memory.shift()
      }
    }
  }
  let completed = 0
  const esc = (s: string) => `"${s.replaceAll('"', '""')}"`
  const queue = [...todo]
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      for (;;) {
        const r = queue.shift()
        if (!r) break
        const recent = memoryByExpense.get(r.expenseId) ?? []
        const out = await callJev(
          r.title,
          recent,
          r.groupName,
          mode === 'blind',
        )
        appendFileSync(
          file,
          `${r.expenseId},${esc(r.title)},${r.stored},${out.jevId},${out.confidence.toFixed(4)},${out.margin.toFixed(4)},${mode},${esc(out.error)}\n`,
        )
        if (++completed % 200 === 0)
          console.log(`  ...${completed}/${todo.length}`)
      }
    },
  )
  await Promise.all(workers)
  console.log(`Jev ${mode} done: ${completed} calls → ${file}`)
}

function floorAnalysis() {
  const file = join(outDir, 'jev_results.csv')
  if (!existsSync(file)) {
    console.log('No jev_results.csv — skipping floor analysis')
    return
  }
  const lines = parseCsvSync(file).slice(1)
  const ok = lines
    .filter((p) => !p[7] && p[3])
    .map((p) => ({ stored: p[2]!, jevId: p[3]!, confidence: Number(p[4]!) }))
    .filter((r) => r.stored !== GENERAL && asCategoryId(r.stored))
  const out = ['floor,coverage,precision,n']
  let proposal = 'Could not propose a floor — inspect jev_floor_table.csv.\n'
  for (const floor of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
    const above = ok.filter((r) => r.confidence >= floor)
    const correct = above.filter((r) => r.jevId === r.stored).length
    const precision = above.length > 0 ? correct / above.length : 0
    out.push(
      `${floor},${(above.length / Math.max(1, ok.length)).toFixed(4)},${precision.toFixed(4)},${above.length}`,
    )
    if (
      proposal.startsWith('Could not') &&
      above.length >= 50 &&
      precision >= 0.95
    ) {
      proposal = `Proposed AI floor (>=95% precision, max coverage):\nAI_CATEGORY_MIN_CONFIDENCE=${floor}\n`
    }
  }
  writeFileSync(join(outDir, 'jev_floor_table.csv'), out.join('\n') + '\n')
  // Disagreement sample for audit (cap 2000).
  const dis = ['expense_id,title,stored,jev_id,confidence']
  for (const p of lines) {
    if (dis.length >= 2000) break
    if (!p[7] && p[3] && p[3] !== p[2]) {
      dis.push(
        `${p[0]},"${(p[1] ?? '').replaceAll('"', '""')}",${p[2]},${p[3]},${p[4]}`,
      )
    }
  }
  writeFileSync(join(outDir, 'disagreements_jev.csv'), dis.join('\n') + '\n')
  writeFileSync(join(outDir, 'jev_floor_proposal.txt'), proposal)
  console.log(proposal.trim())
}

async function blindLift() {
  const histFile = join(outDir, 'jev_results.csv')
  const blindFile = join(outDir, 'blind_results.csv')
  if (!existsSync(histFile) || !existsSync(blindFile)) {
    console.log('Missing jev/blind results — skipping lift comparison')
    return
  }
  const hist = new Map(
    parseCsvSync(histFile)
      .slice(1)
      .map((p) => [p[0], p] as const),
  )
  let n = 0,
    histCorrect = 0,
    blindCorrect = 0
  for (const p of parseCsvSync(blindFile).slice(1)) {
    const h = hist.get(p[0]!)
    if (!h || p[7] || h[7] || !p[3] || !h[3] || p[2] === GENERAL) continue
    if (!asCategoryId(p[2]!)) continue
    n++
    if (p[3] === p[2]) blindCorrect++
    if (h[3] === p[2]) histCorrect++
  }
  const text =
    n > 0
      ? `Blind vs with-history Jev accuracy on ${n} shared titles:\nblind=${(blindCorrect / n).toFixed(4)} with_history=${(histCorrect / n).toFixed(4)} lift=${((histCorrect - blindCorrect) / n).toFixed(4)}\n`
      : 'No overlapping blind/history results to compare.\n'
  writeFileSync(join(outDir, 'blind_lift.txt'), text)
  console.log(text.trim())
}

// --- main ---
await loadLocaleDictionary(LOCALE)
const rows = await loadDump()
console.log(`Loaded ${rows.length} expenses`)

if (phase === '1' || phase === 'all') await phase1(rows)
if (phase === '2' || phase === 'all') {
  await runJevPass(rows, 'history')
  floorAnalysis()
}
if (phase === 'blind' || phase === 'all') {
  // Evenly spaced sample of up to 500 already-processed expenses.
  const histFile = join(outDir, 'jev_results.csv')
  let ids: Set<string> | undefined
  if (existsSync(histFile)) {
    const doneIds = [...loadDoneIds(histFile)]
    const step = Math.max(1, Math.floor(doneIds.length / 500))
    ids = new Set(doneIds.filter((_, i) => i % step === 0).slice(0, 500))
  }
  if (ids && ids.size > 0) {
    await runJevPass(rows, 'blind', ids)
    await blindLift()
  } else {
    console.log('Blind pass needs phase-2 results first — skipping')
  }
}
console.log('Done.')

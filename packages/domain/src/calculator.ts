import type { Currency } from './currency'

type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'openParen' }
  | { type: 'closeParen' }

type Expression =
  | { type: 'number'; value: number }
  | { type: 'unary'; operator: '+' | '-'; operand: Expression }
  | {
      type: 'binary'
      operator: '+' | '-' | '*' | '/'
      left: Expression
      right: Expression
    }

export type CalculatorItem = {
  quantity: number
  unitPrice: number
}

export type CalculatorEvaluation = { ok: true; value: number } | { ok: false }

export type CalculatorDecomposition =
  | { ok: true; items: CalculatorItem[] }
  | { ok: false }

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const character = input[index]
    if (/\s/.test(character)) {
      index++
      continue
    }

    if (/\d|\./.test(character)) {
      const start = index
      let decimalCount = 0
      while (index < input.length && /\d|\./.test(input[index])) {
        if (input[index] === '.') decimalCount++
        index++
      }
      const rawNumber = input.slice(start, index)
      const value = Number(rawNumber)
      if (decimalCount > 1 || rawNumber === '.' || !Number.isFinite(value)) {
        return null
      }
      tokens.push({ type: 'number', value })
      continue
    }

    if ('+-*/×÷'.includes(character)) {
      tokens.push({
        type: 'operator',
        value:
          character === '×'
            ? '*'
            : character === '÷'
              ? '/'
              : (character as '+' | '-' | '*' | '/'),
      })
      index++
      continue
    }

    if (character === '(') {
      tokens.push({ type: 'openParen' })
      index++
      continue
    }

    if (character === ')') {
      tokens.push({ type: 'closeParen' })
      index++
      continue
    }

    return null
  }

  return tokens
}

function parse(input: string): Expression | null {
  const tokens = tokenize(input)
  if (!tokens?.length) return null

  let index = 0
  let parenthesesUsed = 0

  const peek = () => tokens[index]
  const consume = () => tokens[index++]

  const parseExpression = (): Expression | null => {
    let left = parseTerm()
    if (!left) return null

    while (true) {
      const token = peek()
      if (
        token?.type !== 'operator' ||
        (token.value !== '+' && token.value !== '-')
      ) {
        break
      }
      const operator = consume() as Extract<Token, { type: 'operator' }>
      const right = parseTerm()
      if (!right) return null
      left = {
        type: 'binary',
        operator: operator.value as '+' | '-',
        left,
        right,
      }
    }

    return left
  }

  const parseTerm = (): Expression | null => {
    let left = parseFactor()
    if (!left) return null

    while (true) {
      const token = peek()
      if (
        token?.type !== 'operator' ||
        (token.value !== '*' && token.value !== '/')
      ) {
        break
      }
      const operator = consume() as Extract<Token, { type: 'operator' }>
      const right = parseFactor()
      if (!right) return null
      left = {
        type: 'binary',
        operator: operator.value as '*' | '/',
        left,
        right,
      }
    }

    return left
  }

  const parseFactor = (): Expression | null => {
    const token = peek()
    if (!token) return null

    if (token.type === 'number') {
      consume()
      return { type: 'number', value: token.value }
    }

    if (
      token.type === 'operator' &&
      (token.value === '+' || token.value === '-')
    ) {
      consume()
      const operand = parseFactor()
      if (!operand) return null
      return { type: 'unary', operator: token.value, operand }
    }

    if (token.type === 'openParen') {
      if (parenthesesUsed > 0) return null
      parenthesesUsed++
      consume()
      const expression = parseExpression()
      if (!expression || peek()?.type !== 'closeParen') return null
      consume()
      return expression
    }

    return null
  }

  const expression = parseExpression()
  return expression && index === tokens.length ? expression : null
}

function evaluate(expression: Expression): number | null {
  if (expression.type === 'number') return expression.value

  if (expression.type === 'unary') {
    const value = evaluate(expression.operand)
    if (value == null) return null
    return expression.operator === '-' ? -value : value
  }

  const left = evaluate(expression.left)
  const right = evaluate(expression.right)
  if (left == null || right == null) return null

  const value =
    expression.operator === '+'
      ? left + right
      : expression.operator === '-'
        ? left - right
        : expression.operator === '*'
          ? left * right
          : right === 0
            ? null
            : left / right

  return value != null && Number.isFinite(value) ? value : null
}

/** Evaluate a calculator expression without using JavaScript's `eval`. */
export function evaluateCalculatorExpression(
  input: string,
): CalculatorEvaluation {
  const expression = parse(input)
  if (!expression) return { ok: false }

  const value = evaluate(expression)
  return value == null ? { ok: false } : { ok: true, value }
}

function flattenAddition(expression: Expression): Expression[] {
  if (expression.type === 'binary' && expression.operator === '+') {
    return [
      ...flattenAddition(expression.left),
      ...flattenAddition(expression.right),
    ]
  }
  return [expression]
}

function flattenMultiplication(expression: Expression): Expression[] {
  if (expression.type === 'binary' && expression.operator === '*') {
    return [
      ...flattenMultiplication(expression.left),
      ...flattenMultiplication(expression.right),
    ]
  }
  return [expression]
}

function itemForNumberFactors(factors: number[]): CalculatorItem | null {
  if (!factors.length || factors.some((factor) => factor <= 0)) return null

  if (factors.length === 1) {
    return { quantity: 1, unitPrice: factors[0] }
  }

  const integerFactors = factors.filter(
    (factor) => Number.isSafeInteger(factor) && factor > 0,
  )
  if (!integerFactors.length) {
    const unitPrice = factors.reduce((product, factor) => product * factor, 1)
    return Number.isFinite(unitPrice) ? { quantity: 1, unitPrice } : null
  }

  const quantity = Math.min(...integerFactors)
  const quantityIndex = factors.indexOf(quantity)
  const unitPrice = factors
    .filter((_, index) => index !== quantityIndex)
    .reduce((product, factor) => product * factor, 1)

  return Number.isFinite(unitPrice) && unitPrice > 0
    ? { quantity, unitPrice }
    : null
}

function decomposeTerm(expression: Expression): CalculatorItem[] | null {
  const factors = flattenMultiplication(expression)
  const numbers: number[] = []
  let groupedExpression: Expression | null = null

  for (const factor of factors) {
    if (factor.type === 'number') {
      numbers.push(factor.value)
      continue
    }

    if (factor.type === 'binary' && factor.operator === '+') {
      if (groupedExpression) return null
      groupedExpression = factor
      continue
    }

    return null
  }

  if (!groupedExpression) {
    const item = itemForNumberFactors(numbers)
    return item ? [item] : null
  }

  const multiplier = numbers.reduce((product, factor) => product * factor, 1)
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) return null

  const items = decomposeExpression(groupedExpression)
  if (!items) return null

  const scaledItems = items.map((item) => ({
    ...item,
    quantity: item.quantity * multiplier,
  }))

  return scaledItems.every(
    (item) => Number.isSafeInteger(item.quantity) && item.quantity > 0,
  )
    ? scaledItems
    : null
}

function decomposeExpression(expression: Expression): CalculatorItem[] | null {
  const items: CalculatorItem[] = []

  for (const term of flattenAddition(expression)) {
    const termItems = decomposeTerm(term)
    if (!termItems) return null
    items.push(...termItems)
  }

  return items
}

/**
 * Convert an addition/multiplication expression into receipt-like quantity and
 * unit-price rows. Subtraction, division, and negative values do not map safely
 * to expense items and therefore return `ok: false`.
 */
export function decomposeCalculatorExpression(
  input: string,
): CalculatorDecomposition {
  const expression = parse(input)
  if (!expression) return { ok: false }

  const items = decomposeExpression(expression)
  return items ? { ok: true, items } : { ok: false }
}

/** Round a calculator result to the precision accepted by the selected currency. */
export function formatCalculatorAmount(
  value: number,
  currency: Currency,
): string {
  if (!Number.isFinite(value)) return ''

  const scale = 10 ** currency.decimal_digits
  const rounded =
    Math.round((value + Math.sign(value) * Number.EPSILON) * scale) / scale
  return rounded
    .toFixed(currency.decimal_digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
}

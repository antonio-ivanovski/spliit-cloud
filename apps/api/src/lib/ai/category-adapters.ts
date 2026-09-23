import {
  interpretCategorizerResult,
  validSuggestedCategory,
  type AiCategoryDistribution,
  type CategorizerChoice,
  type CategorizerResult,
  type CategoryId,
} from '@spliit/domain'

export type JevCategoryAnswer = {
  categoryId: CategoryId
  confidence: number
  probabilities: readonly { categoryId: CategoryId; probability: number }[]
}

export function adaptJevCategory(
  answer: JevCategoryAnswer | null | undefined,
  floor: number,
  rejected: ReadonlySet<CategoryId> = new Set(),
): CategorizerResult {
  const id = validSuggestedCategory(answer?.categoryId)
  const primary: CategorizerChoice | null =
    id && !rejected.has(id)
      ? {
          categoryId: id,
          source: 'jev',
          evidence: {
            kind: 'model-confidence',
            value: answer!.confidence,
            floor,
          },
        }
      : null
  const alternatives: CategorizerChoice[] =
    answer?.probabilities
      .filter((row) => row.probability >= 0.15)
      .map((row): CategorizerChoice | null => {
        const categoryId = validSuggestedCategory(row.categoryId)
        return categoryId && !rejected.has(categoryId)
          ? {
              categoryId,
              source: 'jev',
              evidence: {
                kind: 'option-probability',
                value: row.probability,
              },
            }
          : null
      })
      .filter((row): row is CategorizerChoice => row !== null) ?? []
  return interpretCategorizerResult('jev', primary, alternatives)
}

export function adaptLlmCategory(
  answer: {
    categoryId: CategoryId | null
    confidence: number
    distribution: readonly AiCategoryDistribution[]
  },
  floor: number,
): CategorizerResult {
  const id = validSuggestedCategory(answer.categoryId)
  const primary: CategorizerChoice | null = id
    ? {
        categoryId: id,
        source: 'llm',
        evidence: {
          kind: 'self-reported-confidence',
          value: answer.confidence,
          floor,
        },
      }
    : null
  const alternatives: CategorizerChoice[] = answer.distribution
    .filter((row) => row.probability >= 0.15)
    .map((row): CategorizerChoice | null => {
      const categoryId = validSuggestedCategory(row.id)
      return categoryId
        ? {
            categoryId,
            source: 'llm',
            evidence: {
              kind: 'option-probability',
              value: row.probability,
            },
          }
        : null
    })
    .filter((row): row is CategorizerChoice => row !== null)
  return interpretCategorizerResult('llm', primary, alternatives)
}

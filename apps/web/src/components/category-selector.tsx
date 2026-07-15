import { Check, ChevronDown, ChevronsUpDown, Sparkles } from 'lucide-react'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import type { DEFAULT_CATEGORIES } from '@spliit/domain'
import { type Category, type CategoryId } from '@spliit/domain'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  categories: ReadonlyArray<Category>
  onValueChange: (categoryId: CategoryId) => void
  /** Category ID to be selected by default. Overwriting this value will update current selection, too. */
  defaultValue: CategoryId
  isLoading: boolean
  disabled?: boolean
  /** Render an icon-only trigger for embedding beside a title input. */
  compact?: boolean
  /** Multi-select mode for filter panels. Defaults to 'single'. */
  mode?: 'single' | 'multi'
  /** IDs currently selected (multi mode only). */
  selectedValues?: CategoryId[]
  /** Toggle a category ID in multi mode. */
  onValueToggle?: (categoryId: CategoryId) => void
  /** Trigger text when nothing selected in multi mode. */
  multiPlaceholder?: string
}

export function CategorySelector({
  categories,
  onValueChange,
  defaultValue,
  isLoading,
  disabled = false,
  compact = false,
  mode = 'single',
  selectedValues = [],
  onValueToggle,
  multiPlaceholder,
}: Props) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selectedCategory =
    categories.find((category) => category.id === defaultValue) ?? categories[0]

  if (mode === 'multi') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 px-3 text-sm justify-between font-normal"
          >
            <span className="truncate">
              {selectedValues.length > 0
                ? `${selectedValues.length} selected`
                : (multiPlaceholder ?? 'Select')}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <CategoryCommand
            categories={categories}
            mode="multi"
            selectedValues={selectedValues}
            onValueToggle={(id) => {
              onValueToggle?.(id)
            }}
          />
        </PopoverContent>
      </Popover>
    )
  }

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <CategoryButton
            category={selectedCategory}
            open={open}
            isLoading={isLoading}
            disabled={disabled}
            compact={compact}
          />
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <CategoryCommand
            categories={categories}
            onValueChange={(id) => {
              onValueChange(id)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <CategoryButton
          category={selectedCategory}
          open={open}
          isLoading={isLoading}
          disabled={disabled}
          compact={compact}
        />
      </DrawerTrigger>
      <DrawerContent className="p-0">
        <CategoryCommand
          categories={categories}
          onValueChange={(id) => {
            onValueChange(id)
            setOpen(false)
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}

function CategoryCommand({
  categories,
  onValueChange,
  mode = 'single',
  selectedValues = [],
  onValueToggle,
}: {
  categories: ReadonlyArray<Category>
  onValueChange?: (categoryId: CategoryId) => void
  mode?: 'single' | 'multi'
  selectedValues?: CategoryId[]
  onValueToggle?: (categoryId: CategoryId) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  const categoriesByGroup = categories.reduce<Record<string, Category[]>>(
    (acc, category) => ({
      ...acc,
      [category.grouping]: [...(acc[category.grouping] ?? []), category],
    }),
    {},
  )

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noCategory')}</CommandEmpty>
      <div className="w-full max-h-[300px] overflow-y-auto">
        {Object.entries(categoriesByGroup).map(([group, groupCategories]) => (
          <CommandGroup
            key={group}
            heading={t(
              CATEGORY_GROUPING_HEADINGS[
                group as keyof typeof CATEGORY_GROUPING_HEADINGS
              ],
            )}
          >
            {groupCategories.map((category) => (
              <CommandItem
                key={category.id}
                value={`${category.id} ${t(
                  CATEGORY_GROUPING_HEADINGS[category.grouping],
                )} ${t(categoryLabelKey(category))}`}
                onSelect={(currentValue) => {
                  const id = currentValue.split(' ')[0] as CategoryId
                  if (mode === 'multi') {
                    onValueToggle?.(id)
                  } else {
                    onValueChange?.(id)
                  }
                }}
              >
                {mode === 'multi' && (
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      selectedValues.includes(category.id) ? '' : 'invisible',
                    )}
                  />
                )}
                <CategoryLabel category={category} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </div>
    </Command>
  )
}

const CATEGORY_GROUPING_HEADINGS = {
  Uncategorized: 'Uncategorized.heading',
  Entertainment: 'Entertainment.heading',
  'Food and Drink': 'Food and Drink.heading',
  Home: 'Home.heading',
  Life: 'Life.heading',
  Transportation: 'Transportation.heading',
  Utilities: 'Utilities.heading',
} as const satisfies Record<
  (typeof DEFAULT_CATEGORIES)[number]['grouping'],
  string
>

type CategoryLabelKey = (typeof DEFAULT_CATEGORIES)[number] extends infer C
  ? C extends { grouping: infer G; name: infer N }
    ? G extends string
      ? N extends string
        ? `${G}.${N}`
        : never
      : never
    : never
  : never

function categoryLabelKey(category: Category): CategoryLabelKey {
  return `${category.grouping}.${category.name}` as CategoryLabelKey
}

type CategoryButtonProps = {
  category: Category
  open: boolean
  isLoading: boolean
  disabled?: boolean
  compact?: boolean
}
const CategoryButton = forwardRef<HTMLButtonElement, CategoryButtonProps>(
  (
    {
      category,
      open,
      isLoading,
      compact = false,
      className,
      ...props
    }: ButtonProps & CategoryButtonProps,
    ref,
  ) => {
    const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
    const iconClassName = 'h-4 w-4 shrink-0 opacity-50'
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        aria-busy={isLoading}
        aria-label={t(categoryLabelKey(category))}
        className={
          compact
            ? `h-10 w-16 shrink-0 rounded-none border-0 px-3 gap-2 ${className ?? ''}`
            : `flex w-full ${className ?? ''}`
        }
        ref={ref}
        {...props}
      >
        <span
          className={
            compact ? 'flex items-center justify-center' : 'flex-1 text-left'
          }
        >
          <CategoryLabel category={category} compact={compact} />
        </span>
        {isLoading ? (
          <Sparkles
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-primary motion-reduce:animate-none animate-sparkle-pulse"
          />
        ) : (
          <ChevronDown className={iconClassName} />
        )}
      </Button>
    )
  },
)
CategoryButton.displayName = 'CategoryButton'

function CategoryLabel({
  category,
  compact = false,
}: {
  category: Category
  compact?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  return (
    <div className="flex items-center gap-3">
      <CategoryIcon category={category} className="w-4 h-4" />
      {!compact && t(categoryLabelKey(category))}
    </div>
  )
}

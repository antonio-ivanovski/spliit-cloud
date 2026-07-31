/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- popover triggers expose combobox semantics; popup IDs are managed by the UI primitive. */
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Layers,
  Sparkles,
} from 'lucide-react'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import {
  type DEFAULT_CATEGORIES,
  type Category,
  type CategoryId,
  DEFAULT_CATEGORY_ID,
  categorySelectionDisplayCount,
  getCategoryById,
  getChildCategories,
  isParentCategory,
} from '@spliit/domain'

type Props = {
  categories: ReadonlyArray<Category>
  onValueChange: (categoryId: CategoryId) => void
  /**
   * Category ID to be selected by default. Overwriting this value will update
   * current selection, too.
   */
  defaultValue: CategoryId
  isLoading: boolean
  disabled?: boolean
  /** Render an icon-only trigger for embedding beside a title input. */
  compact?: boolean
  /** Multi-select mode for filter panels. Defaults to 'single'. */
  mode?: 'single' | 'multi'
  /** IDs currently selected (multi mode only). */
  selectedValues?: CategoryId[]
  /**
   * Toggle a category ID in multi mode (apply toggleCategorySelection at the
   * call site).
   */
  onValueToggle?: (categoryId: CategoryId) => void
  /** Trigger text when nothing selected in multi mode. */
  multiPlaceholder?: string
  /** Title and action label shown by the mobile multi-select drawer. */
  mobileTitle?: string
  mobileDoneLabel?: string
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
  mobileTitle,
  mobileDoneLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { t } = useTranslation()

  const selectedCategory =
    categories.find((category) => category.id === defaultValue) ??
    categories.find((category) => category.id === DEFAULT_CATEGORY_ID) ??
    getCategoryById(DEFAULT_CATEGORY_ID)!

  const hierarchy = buildHierarchy(categories)
  const multiCount = categorySelectionDisplayCount(selectedValues, categories)

  if (mode === 'multi') {
    const command = (
      <CategoryCommand
        hierarchy={hierarchy}
        mode="multi"
        selectedValues={selectedValues}
        onValueToggle={onValueToggle}
      />
    )

    if (!isDesktop) {
      return (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger
            render={
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                className="h-9 w-full justify-between px-3 text-sm font-normal"
              >
                <span className="truncate">
                  {multiCount > 0
                    ? t('Expenses.filters.nSelected', {
                        count: multiCount,
                      })
                    : (multiPlaceholder ?? 'Select')}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            }
          />
          <DrawerContent className="p-0">
            <DrawerHeader className="pb-2 text-start">
              <DrawerTitle>
                {mobileTitle ?? t('Expenses.filters.category')}
              </DrawerTitle>
            </DrawerHeader>
            <div className="min-h-0 overflow-y-auto px-1">{command}</div>
            <DrawerFooter className="border-t bg-background pt-3">
              <Button type="button" onClick={() => setOpen(false)}>
                {mobileDoneLabel ?? t('Groups.Import.StepHeader.done')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            className="h-9 w-full justify-between px-3 text-sm font-normal"
          >
            <span className="truncate">
              {multiCount > 0
                ? t('Expenses.filters.nSelected', { count: multiCount })
                : (multiPlaceholder ?? 'Select')}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0"
          align="start"
          onFocusOutside={(event) => event.preventDefault()}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {command}
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
        <PopoverContent
          className="p-0"
          align="start"
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <CategoryCommand
            hierarchy={hierarchy}
            mode="single"
            selectedValues={[selectedCategory.id]}
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
      <DrawerTrigger
        render={
          <CategoryButton
            category={selectedCategory}
            open={open}
            isLoading={isLoading}
            disabled={disabled}
            compact={compact}
          />
        }
      />
      <DrawerContent className="p-0">
        <CategoryCommand
          hierarchy={hierarchy}
          mode="single"
          selectedValues={[selectedCategory.id]}
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
  hierarchy,
  onValueChange,
  mode = 'single',
  selectedValues = [],
  onValueToggle,
}: {
  hierarchy: Hierarchy
  onValueChange?: (categoryId: CategoryId) => void
  mode?: 'single' | 'multi'
  selectedValues?: CategoryId[]
  onValueToggle?: (categoryId: CategoryId) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  const selectedSet = new Set(selectedValues)
  const isEffectivelySelected = (category: Category) =>
    selectedSet.has(category.id) ||
    (category.parentId !== null && selectedSet.has(category.parentId))

  return (
    <Command>
      <CommandInput placeholder={t('search')} className="text-base" />
      <CommandEmpty>{t('noCategory')}</CommandEmpty>
      <div className="max-h-[300px] w-full overflow-y-auto">
        {hierarchy.map(({ parent, children }) => {
          const groupLabel = t(
            CATEGORY_GROUPING_HEADINGS[
              parent.grouping as keyof typeof CATEGORY_GROUPING_HEADINGS
            ],
          )
          const includesLabel = t('groupIncludes')
          const parentSelected =
            mode === 'multi'
              ? isEffectivelySelected(parent)
              : selectedSet.has(parent.id)

          return (
            <CommandGroup key={parent.id}>
              <CommandItem
                value={`${parent.id} ${String(groupLabel)} ${String(includesLabel)}`}
                onSelect={() => {
                  if (mode === 'multi') {
                    onValueToggle?.(parent.id)
                  } else {
                    onValueChange?.(parent.id)
                  }
                }}
                aria-label={
                  children.length > 0
                    ? `${String(groupLabel)} (${String(includesLabel)})`
                    : String(groupLabel)
                }
                className="w-full bg-muted/40 font-semibold"
              >
                {mode === 'multi' && (
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      parentSelected ? '' : 'invisible',
                    )}
                  />
                )}
                <Layers className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate">{groupLabel}</span>
                  {children.length > 0 && (
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {includesLabel}
                    </span>
                  )}
                </span>
              </CommandItem>
              {children.map((category) => {
                const childSelected =
                  mode === 'multi'
                    ? isEffectivelySelected(category)
                    : selectedSet.has(category.id)
                const childLabel = categoryLabel(t, category.id)
                return (
                  <CommandItem
                    key={category.id}
                    value={`${category.id} ${groupLabel} ${childLabel}`}
                    onSelect={() => {
                      if (mode === 'multi') {
                        onValueToggle?.(category.id)
                      } else {
                        onValueChange?.(category.id)
                      }
                    }}
                  >
                    {mode === 'multi' && (
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          childSelected ? '' : 'invisible',
                        )}
                      />
                    )}
                    <span className="pl-8">
                      <CategoryLabel category={category} />
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )
        })}
      </div>
    </Command>
  )
}

type Hierarchy = Array<{ parent: Category; children: Category[] }>

function buildHierarchy(categories: ReadonlyArray<Category>): Hierarchy {
  const parents = categories.filter((category) => isParentCategory(category))
  return parents.map((parent) => ({
    parent,
    children: getChildCategories(parent.id, categories),
  }))
}

const CATEGORY_GROUPING_HEADINGS = {
  Uncategorized: 'Uncategorized.heading',
  Entertainment: 'Entertainment.heading',
  'Food and Drink': 'Food and Drink.heading',
  Home: 'Home.heading',
  Life: 'Life.heading',
  Transportation: 'Transportation.heading',
  Utilities: 'Utilities.heading',
  'Social and Activities': 'Social and Activities.heading',
  'Subscriptions and Memberships': 'Subscriptions and Memberships.heading',
  'Personal Care and Wellness': 'Personal Care and Wellness.heading',
} as const satisfies Record<
  (typeof DEFAULT_CATEGORIES)[number]['grouping'],
  string
>

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
    const label = categoryLabel(t, category.id)
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={isLoading}
        aria-label={label}
        className={
          compact
            ? `h-10 w-16 shrink-0 gap-2 rounded-none border-0 px-3 ${className ?? ''}`
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
            className="h-4 w-4 shrink-0 animate-sparkle-pulse text-primary motion-reduce:animate-none"
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
      <CategoryIcon category={category} className="h-4 w-4" />
      {!compact && categoryLabel(t, category.id)}
    </div>
  )
}

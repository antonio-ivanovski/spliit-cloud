import { ChevronDown, Loader2 } from 'lucide-react'

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
}

export function CategorySelector({
  categories,
  onValueChange,
  defaultValue,
  isLoading,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const selectedCategory =
    categories.find((category) => category.id === defaultValue) ?? categories[0]

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <CategoryButton
            category={selectedCategory}
            open={open}
            isLoading={isLoading}
            disabled={disabled}
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
}: {
  categories: ReadonlyArray<Category>
  onValueChange: (categoryId: CategoryId) => void
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
        {Object.entries(categoriesByGroup).map(
          ([group, groupCategories], index) => (
            <CommandGroup
              key={index}
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
                    onValueChange(id)
                  }}
                >
                  <CategoryLabel category={category} />
                </CommandItem>
              ))}
            </CommandGroup>
          ),
        )}
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
}
const CategoryButton = forwardRef<HTMLButtonElement, CategoryButtonProps>(
  (
    { category, open, isLoading, ...props }: ButtonProps & CategoryButtonProps,
    ref,
  ) => {
    const iconClassName = 'ml-2 h-4 w-4 shrink-0 opacity-50'
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="flex w-full"
        ref={ref}
        {...props}
      >
        <span className="flex-1 text-left">
          <CategoryLabel category={category} />
        </span>
        {isLoading ? (
          <Loader2 className={`animate-spin ${iconClassName}`} />
        ) : (
          <ChevronDown className={iconClassName} />
        )}
      </Button>
    )
  },
)
CategoryButton.displayName = 'CategoryButton'

function CategoryLabel({ category }: { category: Category }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Categories' })
  return (
    <div className="flex items-center gap-3">
      <CategoryIcon category={category} className="w-4 h-4" />
      {t(categoryLabelKey(category))}
    </div>
  )
}

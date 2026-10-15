import { Card, CardContent } from '@web/components/ui/card'
import { Check } from 'lucide-react'

/**
 * The source-tab roster: Splitwise (already in), Tricount, Settle Up. Editorial
 * crop of the import wizard's source tabs.
 */
export function SourceRoster({
  tricountIn = false,
  settleUpIn = false,
}: {
  tricountIn?: boolean
  settleUpIn?: boolean
}) {
  const tabs = [
    { name: 'Splitwise', in: true },
    { name: 'Tricount', in: tricountIn },
    { name: 'Settle Up', in: settleUpIn },
  ]
  return (
    <Card>
      <CardContent spacing="standalone" className="flex flex-col gap-2">
        {tabs.map((tab) => (
          <div
            key={tab.name}
            className={`roster-row ${tab.in ? 'roster-in' : 'roster-out'}`}
          >
            <span>{tab.name}</span>
            {tab.in ? (
              <span className="roster-check">
                <Check size={18} /> in
              </span>
            ) : (
              <span className="roster-pending">new</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

import '@fontsource-variable/nunito/wght.css'
import './styles.css'
import { createRoot } from 'react-dom/client'

import { campaigns, selectCampaign } from './catalog'
import type { StaticVariant } from './catalog'
import { compositions } from './registry'

function Studio() {
  const params = new URLSearchParams(window.location.search)
  const id = params.get('campaign')
  const variant = params.get('variant')
  if (!id) {
    return (
      <div className="studio">
        <h1>Spliit promo studio</h1>
        <p>Select a composition to preview its export canvas.</p>
        {campaigns.map((campaign) => (
          <section key={campaign.id}>
            <h2>{campaign.title}</h2>
            {Object.entries(campaign.variants)
              .filter(([, entry]) => entry.kind === 'static')
              .map(([name, size]) => (
                <a
                  key={name}
                  href={`?${new URLSearchParams({ campaign: campaign.id, variant: name })}`}
                >
                  {name} · {size.width}×{size.height}
                </a>
              ))}
          </section>
        ))}
      </div>
    )
  }
  let selection: { variants: Array<[string, StaticVariant]> } | undefined
  let failure: string | undefined
  try {
    selection = selectCampaign(id, variant ?? undefined)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const [name, size] = selection?.variants[0] ?? []
  const Composition = name ? compositions[id]?.[name] : undefined
  if (!Composition || !size) {
    return (
      <div className="studio" data-promo-error>
        <h1>Unable to preview campaign</h1>
        <p>{failure ?? `Composition missing for ${id}/${name}`}</p>
        <a href="?">All campaigns</a>
      </div>
    )
  }
  return <Composition {...size} />
}

createRoot(document.getElementById('root')!).render(<Studio />)

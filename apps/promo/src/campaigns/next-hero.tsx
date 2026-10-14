import { Badge } from '@web/components/ui/badge'

import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas } from '../primitives'

import './next-release.css'

/**
 * Generic v2.8.0 hero: version badge + generic title. Feature/bugfix pills
 * below name the major items without duplicating the story promos.
 */
const pills = [
  'Currency swap + entry currency',
  'Lev & kuna keep working',
  'Android share to Spliit',
  'Rich invite previews',
  'Smarter notifications',
  'Split + speed fixes',
]

export function NextHeroPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="next-promo next-hero">
      <BrandHeader version="v2.8.0" />
      <div className="next-hero-copy">
        <h1>
          Spliit Cloud <em>v2.8.0</em>
        </h1>
        <p>
          Currency tools, legacy money, and Android sharing — plus richer
          invites, smarter notifications, and faster, steadier pages.
        </p>
      </div>
      <div className="next-hero-pills">
        {pills.map((label) => (
          <Badge key={label} variant="secondary" className="next-hero-pill">
            {label}
          </Badge>
        ))}
      </div>
      <p className="next-hero-foot">
        Currency swap · Lev & kuna imports · Share → Spliit · Fixes & polish
      </p>
    </Canvas>
  )
}

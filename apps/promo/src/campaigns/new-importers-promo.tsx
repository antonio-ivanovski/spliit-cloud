import { ArrowRight, FileSpreadsheet, Link2 } from 'lucide-react'

import logo from '../../../web/public/logo-with-text.svg'
import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas } from '../primitives'
import settleupLogo from './tricount-settleup-import/assets/settleup-logo.png'
import tricountLogo from './tricount-settleup-import/assets/tricount-oneline.svg'

import './tricount-settleup-import/promo.css'

const features = [
  'Share-link fetch',
  'Multi-group picker',
  'Settlements',
  'Multi-currency',
]

/**
 * Release-notes image: the two new import sources flow into the Spliit Cloud
 * lockup. 1600×900.
 */
export function NewImportersPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="new-importers-promo">
      <BrandHeader />
      <div className="new-importers-body">
        <p className="new-importers-kicker">Spliit Cloud now imports both.</p>
        <h1>
          Tricount and Settle Up imports, <em>built in.</em>
        </h1>
        <div className="new-importers-flow">
          <div className="new-importers-sources">
            <div className="new-importers-source-card">
              <img
                src={tricountLogo}
                alt="Tricount"
                className="new-importers-source-logo"
              />
              <div className="new-importers-source-data">
                <strong>
                  <Link2 size={26} aria-hidden="true" />
                  tricount.com/skitrip2026
                </strong>
                <span>Paste the link</span>
              </div>
              <span className="new-importers-version">v2.9.0</span>
            </div>
            <div className="new-importers-source-card">
              <img
                src={settleupLogo}
                alt="Settle Up"
                className="new-importers-source-logo"
              />
              <div className="new-importers-source-data">
                <strong>
                  <FileSpreadsheet size={26} aria-hidden="true" />
                  flatshare-history.csv
                </strong>
                <span>Drop the CSV</span>
              </div>
              <span className="new-importers-version">v2.9.0</span>
            </div>
          </div>
          <ArrowRight className="new-importers-arrow" aria-hidden="true" />
          <div className="new-importers-destination">
            <img src={logo} alt="Spliit Cloud" />
          </div>
        </div>
        <div className="new-importers-features">
          {features.map((feature) => (
            <span key={feature} className="new-importers-feature">
              {feature}
            </span>
          ))}
        </div>
      </div>
    </Canvas>
  )
}

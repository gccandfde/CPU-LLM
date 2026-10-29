import React from 'react'

// Thin strip linking the published versions. VITE_VERSION / VITE_CHANNEL are
// set by scripts/build-site.mjs; plain local builds show nothing.
const VERSION = import.meta.env.VITE_VERSION
const CHANNEL = import.meta.env.VITE_CHANNEL // 'stable' | 'preview' | 'previous'
const OTHERS = (import.meta.env.VITE_OTHER_VERSIONS || '').split(',').filter(Boolean) // e.g. "v2:preview"
const LABEL = { stable: 'stable', preview: 'preview: new features, may change', previous: 'previous stable: fixes only', archived: 'archived: kept for reference' }
const LINK = { stable: (v) => `Back to ${v} (stable)`, preview: (v) => `Try ${v} (preview)`, previous: (v) => `${v} (previous stable)`, archived: (v) => `${v} (archived)` }

export default function VersionBar() {
  if (!VERSION) return null
  return (
    <div className={`version-bar ${CHANNEL}`}>
      <span><strong>{VERSION}</strong> · {LABEL[CHANNEL] || CHANNEL}</span>
      <a href={`/${VERSION}/features/`}>What&apos;s in {VERSION}</a>
      {OTHERS.map((o) => {
        const [v, ch] = o.split(':')
        return <a key={v} href={`/${v}/`}>{(LINK[ch] || LINK.preview)(v)}</a>
      })}
      <a href="/versions/">All versions</a>
    </div>
  )
}

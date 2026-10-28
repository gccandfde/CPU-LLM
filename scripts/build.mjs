// `npm run build` (Hostinger runs it after `npm install`). A deploy archive
// carries a prebuilt versioned site (scripts/build-site.mjs), so there is
// nothing to build; without one, build the plain dashboard.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (fs.existsSync(path.join(root, 'site', 'versions.json'))) {
  console.log('Prebuilt versioned site found in site/; nothing to build.')
} else {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'frontend'],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERSION_FIELD = /("version":\s*")([^"]*)(")/
const GENERATED_HEADER =
  '// Generated from shared/ by scripts/sync.mjs. Edit shared/, not this copy.\n'

const read = path => readFile(join(ROOT, path), 'utf8')

export async function loadHarnesses() {
  return JSON.parse(await read('harnesses.json')).harnesses
}

export async function repoVersion() {
  return JSON.parse(await read('package.json')).version
}

async function manifestVersion(harness) {
  return JSON.parse(await read(join(harness.root, harness.manifest))).version
}

// An empty list means every manifest carries the repo version, and the tag does too when one is given.
export async function checkVersions(tag) {
  const expected = await repoVersion()
  const problems = []
  if (tag !== undefined && tag.replace(/^v/, '') !== expected)
    problems.push(`tag ${tag} does not match package.json ${expected}`)
  for (const harness of await loadHarnesses()) {
    const found = await manifestVersion(harness)
    if (found !== expected)
      problems.push(`${harness.root}/${harness.manifest} is ${found}, expected ${expected}`)
  }
  return problems
}

export async function setVersion(version) {
  const files = ['package.json']
  for (const harness of await loadHarnesses()) files.push(join(harness.root, harness.manifest))
  for (const file of files) {
    const text = await read(file)
    if (!VERSION_FIELD.test(text)) throw new Error(`${file} has no version field`)
    await writeFile(join(ROOT, file), text.replace(VERSION_FIELD, `$1${version}$3`))
  }
}

async function expectedVendor() {
  const names = (await readdir(join(ROOT, 'shared'), { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort()
  return new Map(
    await Promise.all(
      names.map(async name => [name, GENERATED_HEADER + (await read(`shared/${name}`))]),
    ),
  )
}

async function actualVendor(directory) {
  const names = await readdir(directory).catch(() => [])
  return new Map(
    await Promise.all(
      names.map(async name => [name, await readFile(join(directory, name), 'utf8')]),
    ),
  )
}

// An empty list means every harness's vendor directory is byte-identical to what shared/ generates.
export async function checkVendor() {
  const expected = await expectedVendor()
  const problems = []
  for (const harness of await loadHarnesses()) {
    const directory = join(ROOT, harness.root, harness.vendor)
    const actual = await actualVendor(directory)
    const label = `${harness.root}/${harness.vendor}`
    for (const [name, content] of expected) {
      if (!actual.has(name)) problems.push(`${label}/${name} is missing`)
      else if (actual.get(name) !== content)
        problems.push(`${label}/${name} differs from shared/${name}`)
    }
    for (const name of actual.keys())
      if (!expected.has(name)) problems.push(`${label}/${name} has no source in shared/`)
  }
  return problems
}

export async function syncVendor() {
  const expected = await expectedVendor()
  for (const harness of await loadHarnesses()) {
    const directory = join(ROOT, harness.root, harness.vendor)
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    for (const [name, content] of expected) await writeFile(join(directory, name), content)
  }
}

// `node scripts/version.mjs 0.5.0` sets the version everywhere.
// `node scripts/version.mjs --check [v0.5.0]` fails when a manifest or the tag disagrees with package.json.
import { checkVersions, repoVersion, setVersion } from './harnesses.mjs'

const [argument, tag] = process.argv.slice(2)

if (argument === '--check') {
  const problems = await checkVersions(tag)
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length > 0) process.exitCode = 1
} else if (argument === undefined) {
  console.log(await repoVersion())
} else if (/^\d+\.\d+\.\d+$/.test(argument)) {
  await setVersion(argument)
} else {
  console.error('Usage: node scripts/version.mjs [X.Y.Z | --check [vX.Y.Z]]')
  process.exitCode = 1
}

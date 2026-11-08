// Copies shared/ into every harness's vendor directory. Use --check to fail on drift without writing.
import { checkVendor, syncVendor } from './harnesses.mjs'

if (process.argv[2] === '--check') {
  const problems = await checkVendor()
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) {
    console.error('Run `npm run sync` and commit the result.')
    process.exitCode = 1
  }
} else {
  await syncVendor()
}

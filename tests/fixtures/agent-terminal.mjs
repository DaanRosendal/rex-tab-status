import { createInterface } from 'node:readline'

// Stands in for a coding agent: reports the status and title it is told to over its terminal.
function report({ state = 'idle', kind, title = 'Agent integration test', titleOnly = false }) {
  process.stdout.write(`\u001b]0;${title}\u0007`)
  if (!titleOnly) {
    const pairs = [`state=${state}`, ...(kind ? [`kind=${kind}`] : []), 'app=claude-code']
    process.stdout.write(`\u001b]7501;${pairs.join(':')}\u001b\\`)
  }
}

report({})
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line)
  if (input.exit) break
  report(input)
}

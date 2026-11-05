import { createInterface } from 'node:readline'

function report({ state = 'idle', title = 'Codex integration test', titleOnly = false }) {
  process.stdout.write(`\u001b]0;${title}\u0007`)
  if (!titleOnly) process.stdout.write(`\u001b]7501;state=${state}:app=codex\u001b\\`)
}

report({})
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line)
  if (input.exit) break
  report(input)
}

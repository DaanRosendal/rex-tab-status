import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimLock, CodexTabs } from '../codex/hooks/codex.mjs'
import { IDLE_DELAY_MS } from '../codex/hooks/idle.mjs'

const SESSION = 'session:s1'
const BLOCK = 'block:b1'
const WINDOW = 'window:w1'
const TERMINAL = 'com.superlogical.terminal'

function setup(label = 'Window 0000beef') {
  const blocks = new Map([[BLOCK, {
    title: '⠹ Fix login redirect | project',
    foreground: { pid: 10, name: 'codex' },
    records: [{ state: 'idle', app: 'codex', owner: { pid: 10, name: 'codex' } }],
  }]])
  const tab = { label }
  const calls = []
  const run = async args => {
    calls.push(args)
    const [noun, verb] = args
    if (noun === 'window' && verb === 'ls') {
      return JSON.stringify({ windows: [{ window_id: WINDOW, label: tab.label, layers: [{ blocks: [...blocks.keys()].map(block_id => ({ block_id, creator_name: TERMINAL })) }] }] })
    }
    if (noun === 'window' && verb === 'rename') {
      tab.label = args.at(-1) || 'Window 0000beef'
      return ''
    }
    if (noun === 'session' && verb === 'inspect') return JSON.stringify({ label: 'project' })
    if (noun === 'block' && verb === 'call') {
      const block = blocks.get(args[args.indexOf('-b') + 1])
      if (!block) return undefined
      const method = args.at(-1)
      if (method === 'program_status') return JSON.stringify({ records: block.records })
      if (method === 'process') return JSON.stringify({ foreground: block.foreground })
      if (method === 'title') return JSON.stringify({ title: block.title, owner: block.titleOwner })
    }
    return undefined
  }
  return { blocks, tab, calls, tabs: new CodexTabs(run), run }
}

function event(name, payload = {}) {
  return { type: 'session_event', payload: { session_id: SESSION, event: { type: 'block_event', payload: { block_id: BLOCK, creator_name: TERMINAL, name, payload } } } }
}

test('Codex native status reports show active and completed states immediately', async () => {
  const { blocks, tab, tabs } = setup()
  for (const [state, emoji] of [['working', '⏳'], ['blocked', '❓'], ['working', '⏳'], ['done', '✅'], ['error', '❌']]) {
    blocks.get(BLOCK).records[0].state = state
    await tabs.handle(event('program_status_changed'))
    assert.equal(tab.label, `${emoji} Fix login redirect | project`)
  }
})

test('idle shows no emoji until five minutes pass without further events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { tab, tabs } = setup()
  await tabs.refresh(SESSION)
  assert.equal(tab.label, 'Fix login redirect | project')
  t.mock.timers.tick(IDLE_DELAY_MS - 1)
  await tabs.handle(event('program_status_changed'))
  assert.equal(tab.label, 'Fix login redirect | project')
  t.mock.timers.tick(1)
  await Promise.resolve()
  await tabs.painting
  assert.equal(tab.label, '💤 Fix login redirect | project')
})

for (const [state, emoji] of [['done', '✅'], ['error', '❌']]) {
  test(`${state} stays visible during the five-minute idle delay`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { blocks, tab, tabs } = setup()
    blocks.get(BLOCK).records[0].state = state
    await tabs.refresh(SESSION)
    blocks.get(BLOCK).records[0].state = 'idle'
    await tabs.refresh(SESSION)
    assert.equal(tab.label, `${emoji} Fix login redirect | project`)
    t.mock.timers.tick(IDLE_DELAY_MS - 1)
    await tabs.refresh(SESSION)
    assert.equal(tab.label, `${emoji} Fix login redirect | project`)
    t.mock.timers.tick(1)
    await Promise.resolve()
    await tabs.painting
    assert.equal(tab.label, '💤 Fix login redirect | project')
  })
}

test('working and unanswered questions cancel the idle countdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { blocks, tab, tabs } = setup()
  await tabs.refresh(SESSION)
  t.mock.timers.tick(IDLE_DELAY_MS - 1)
  blocks.get(BLOCK).records[0].state = 'working'
  await tabs.refresh(SESSION)
  t.mock.timers.tick(IDLE_DELAY_MS)
  await Promise.resolve()
  await tabs.painting
  assert.equal(tab.label, '⏳ Fix login redirect | project')
  blocks.get(BLOCK).records[0].state = 'idle'
  await tabs.refresh(SESSION)
  blocks.get(BLOCK).title = '[ ! ] Action Required | Fix login redirect | project'
  await tabs.refresh(SESSION)
  t.mock.timers.tick(IDLE_DELAY_MS)
  await Promise.resolve()
  await tabs.painting
  assert.equal(tab.label, '❓ Fix login redirect | project')
  blocks.get(BLOCK).title = 'Fix login redirect | project'
  await tabs.refresh(SESSION)
  t.mock.timers.tick(IDLE_DELAY_MS - 1)
  await tabs.refresh(SESSION)
  assert.equal(tab.label, 'Fix login redirect | project')
})

test('shutdown cancels deferred idle repainting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { tab, tabs, calls } = setup()
  await tabs.refresh(SESSION)
  await tabs.restore()
  const before = calls.length
  t.mock.timers.tick(IDLE_DELAY_MS)
  await Promise.resolve()
  await tabs.painting
  assert.equal(calls.length, before)
  assert.equal(tab.label, 'Window 0000beef')
})

test('child work and questions remain visible after the root finishes', async () => {
  const { blocks, tab, tabs } = setup()
  const records = blocks.get(BLOCK).records
  records[0].state = 'done'
  records.push({ id: 'agent', effective_app: 'codex', state: 'blocked' })
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '❓ Fix login redirect | project')
  records[1].state = 'working'
  await tabs.handle(event('program_status_changed'))
  assert.equal(tab.label, '⏳ Fix login redirect | project')
  records.pop()
  await tabs.handle(event('program_status_removed'))
  assert.equal(tab.label, '✅ Fix login redirect | project')
})

test('async questions show blocked even while native status stays working', async () => {
  const { blocks, tab, tabs, calls } = setup()
  const block = blocks.get(BLOCK)
  block.records[0].state = 'working'
  await tabs.refresh(SESSION)
  block.title = '[ ! ] Action Required | Fix login redirect | project'
  await tabs.handle(event('title_changed', { title: block.title }))
  assert.equal(tab.label, '❓ Fix login redirect | project')
  const before = calls.length
  block.title = '[ . ] Action Required | Fix login redirect | project'
  await tabs.handle(event('title_changed', { title: block.title }))
  assert.equal(calls.length, before)
  block.title = '⠸ Fix login redirect | project'
  await tabs.handle(event('title_changed', { title: block.title }))
  assert.equal(tab.label, '⏳ Fix login redirect | project')
})

test('async questions preserve custom names and ordinary title text is not an input signal', async () => {
  const { blocks, tab, tabs } = setup('deploy')
  const block = blocks.get(BLOCK)
  block.records[0].state = 'working'
  block.title = '[ ! ] Action Required | Fix login redirect | project'
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '❓ deploy')
  block.title = 'Action Required for this project'
  await tabs.handle(event('title_changed', { title: block.title }))
  assert.equal(tab.label, '⏳ deploy')
})

test('an old process title cannot mark the current Codex process as blocked', async () => {
  const { blocks, tab, tabs } = setup()
  const block = blocks.get(BLOCK)
  block.records[0].state = 'working'
  block.title = '[ ! ] Action Required | old task'
  block.titleOwner = { pid: 99, name: 'other' }
  await tabs.refresh(SESSION)
  assert.ok(tab.label.startsWith('⏳ '))
})

test('foreign statuses and stale reports from exited Codex processes leave labels alone', async () => {
  const { blocks, tab, tabs } = setup('✅ Claude task')
  const block = blocks.get(BLOCK)
  block.records[0].app = 'claude'
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '✅ Claude task')
  block.records[0].app = 'codex'
  block.foreground = { pid: 20, name: 'zsh' }
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '✅ Claude task')
  await tabs.restore()
  assert.equal(tab.label, '✅ Claude task')
})

test('auto names follow title changes without following spinner ticks', async () => {
  const { blocks, tab, tabs, calls } = setup()
  await tabs.refresh(SESSION)
  const before = calls.length
  await tabs.handle(event('title_changed', { title: '⠸ Fix login redirect | project' }))
  assert.equal(calls.length, before)
  blocks.get(BLOCK).title = '⠸ Second topic'
  await tabs.handle(event('title_changed', { title: '⠸ Second topic' }))
  assert.equal(tab.label, 'Second topic')
  await tabs.restore()
  assert.equal(tab.label, 'Window 0000beef')
})

test('a manual rename during a turn is preserved when Codex exits', async () => {
  const { blocks, tab, tabs } = setup()
  await tabs.refresh(SESSION)
  tab.label = 'deploy $(keep-this-literal)'
  await tabs.handle({ type: 'session_event', payload: { session_id: SESSION, event: { type: 'window_label_changed', payload: { window_id: WINDOW, label: tab.label } } } })
  assert.equal(tab.label, 'deploy $(keep-this-literal)')
  blocks.get(BLOCK).foreground = { pid: 20, name: 'zsh' }
  await tabs.handle(event('process_changed'))
  assert.equal(tab.label, 'deploy $(keep-this-literal)')
})

test('cleanup does not remove a prefix written by another adapter', async () => {
  const { tab, tabs } = setup()
  await tabs.refresh(SESSION)
  tab.label = '❓ Claude task'
  await tabs.restore()
  assert.equal(tab.label, '❓ Claude task')
})

test('Claude owns mixed split tabs during updates and cleanup', async () => {
  const { blocks, tab, tabs } = setup()
  await tabs.refresh(SESSION)
  blocks.set('block:claude', { title: 'Claude task', foreground: { pid: 30, name: 'claude' }, records: [] })
  tab.label = '❓ Claude task'
  blocks.get(BLOCK).records[0].state = 'working'
  await tabs.handle(event('program_status_changed'))
  assert.equal(tab.label, '❓ Claude task')
  await tabs.restore()
  assert.equal(tab.label, '❓ Claude task')
})

test('multiple Codex panes contribute to one tab status', async () => {
  const { blocks, tab, tabs } = setup()
  blocks.get(BLOCK).records[0].state = 'done'
  blocks.set('block:b2', { title: 'Second pane', foreground: { pid: 20, name: 'codex' }, records: [{ state: 'blocked', app: 'codex' }] })
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '❓ Fix login redirect | project')
  blocks.get('block:b2').records[0].state = 'working'
  await tabs.refresh(SESSION)
  assert.equal(tab.label, '⏳ Fix login redirect | project')
})

test('an unreadable sibling process cannot expose a Claude label to Codex updates or cleanup', async () => {
  const { blocks, tab, run } = setup()
  let processFails = false
  const tabs = new CodexTabs(args => processFails && args.at(-1) === 'process' ? undefined : run(args))
  await tabs.refresh(SESSION)
  blocks.set('block:claude', { title: 'Claude task', foreground: { pid: 30, name: 'claude' }, records: [] })
  processFails = true
  const label = tab.label
  blocks.get(BLOCK).records[0].state = 'working'
  await tabs.refresh(SESSION)
  assert.equal(tab.label, label)
  await tabs.restore()
  assert.equal(tab.label, label)
})

test('a failed rename retains ownership so a later title change is still automatic', async () => {
  const { blocks, tab, run } = setup()
  let failRename = false
  const tabs = new CodexTabs(args => failRename && args[0] === 'window' && args[1] === 'rename' ? undefined : run(args))
  await tabs.refresh(SESSION)
  failRename = true
  blocks.get(BLOCK).title = 'Second topic'
  await tabs.refresh(SESSION)
  assert.equal(tab.label, 'Fix login redirect | project')
  failRename = false
  await tabs.refresh(SESSION)
  assert.equal(tab.label, 'Second topic')
})

test('each host selects its own hook format under the same plugin identity', async () => {
  const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
  const claude = await json('../.claude-plugin/plugin.json')
  const marketplace = await json('../.agents/plugins/marketplace.json')
  const source = marketplace.plugins.find(plugin => plugin.name === 'rex-tab-status').source
  assert.deepEqual(source, { source: 'local', path: './codex' })
  const codex = await json(`../${source.path}/.codex-plugin/plugin.json`)
  assert.equal(claude.name, 'rex-tab-status')
  assert.equal(codex.name, claude.name)
  assert.equal(codex.version, claude.version)
  assert.equal(codex.hooks, './hooks/codex.json')
  const claudeHooks = await json('../hooks/hooks.json')
  const codexHooks = await json(`../${source.path}/${codex.hooks}`)
  assert.deepEqual(claudeHooks.modules, ['./register.ts'])
  assert.equal(codexHooks.modules, undefined)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].type, 'command')
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /codex\.mjs/)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].async, true)
})

test('the Codex worker lock cannot replace a running worker or another adapter state file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rex-tab-status-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const lock = join(dir, 'codex-server.pid')
  const claude = join(dir, 'claude-state')
  await writeFile(claude, 'keep')
  const release = await claimLock(lock)
  assert.equal(typeof release, 'function')
  assert.equal((await stat(lock)).mode & 0o777, 0o600)
  assert.equal(await claimLock(lock), undefined)
  assert.equal(await readFile(lock, 'utf8'), String(process.pid))
  await release()
  const next = await claimLock(lock)
  assert.equal(typeof next, 'function')
  await next()
  assert.equal(await readFile(claude, 'utf8'), 'keep')
})

test('a dead Codex worker lock is recovered', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rex-tab-status-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const lock = join(dir, 'codex-server.pid')
  await writeFile(lock, '999999999')
  const release = await claimLock(lock)
  assert.equal(typeof release, 'function')
  await release()
})

test('an unfinished lock is respected while fresh and recovered after its startup window', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rex-tab-status-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const lock = join(dir, 'codex-server.pid')
  await writeFile(lock, '')
  assert.equal(await claimLock(lock), undefined)
  const earlier = new Date(Date.now() - 10000)
  await utimes(lock, earlier, earlier)
  const release = await claimLock(lock)
  assert.equal(typeof release, 'function')
  await release()
})

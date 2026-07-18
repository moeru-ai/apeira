import type { Sandbox } from '../src'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { name, version } from '../package.json'
import {
  createHostExecutor,
  createSandbox,
  sandbox as sandboxPlugin,
  sandboxTools,
  workspaceWriteProfile,
} from '../src'
import { createApplyPatchTool, createExecTool } from '../src/tools/index'

const EXECUTE_OPTIONS = {
  abortSignal: new AbortController().signal,
  messages: [],
  toolCallId: 'tool-call-1',
}

const EXTEND_OPTIONS = {
  state: {},
  turnId: 'turn-1',
}

let testDir: string | undefined
let sandbox: Sandbox | undefined

afterEach(async () => {
  await sandbox?.dispose()
  sandbox = undefined
  if (testDir != null)
    await rm(testDir, { force: true, recursive: true })
  testDir = undefined
})

const createTestSandbox = async () => {
  testDir = await mkdtemp(join(tmpdir(), 'apeira-sandbox-tools-'))
  const host = createHostExecutor()
  sandbox = createSandbox({
    adapter: host,
    profile: workspaceWriteProfile({ cwd: testDir }),
  })
  return sandbox
}

describe('sandbox tools', () => {
  it('provides default tools through the root sandbox plugin', async () => {
    const plugin = sandboxPlugin({
      adapter: createHostExecutor(),
      profile: workspaceWriteProfile(),
    })

    const tools = await plugin.extendTools?.(EXTEND_OPTIONS)
    expect(plugin).toMatchObject({ name, version })
    expect(tools?.map(tool => tool.function.name)).toEqual(['exec', 'write_stdin', 'apply_patch'])
    await plugin.stop?.()
  })

  it('uses package metadata for plugin identity and owns sandbox disposal', async () => {
    const instance = await createTestSandbox()
    const plugin = sandboxTools({ sandbox: instance })

    expect(plugin).toMatchObject({ name: `${name}/tools`, version })
    await plugin.stop?.()
    await expect(instance.check()).rejects.toMatchObject({ code: 'disposed' })
  })

  it('exec maps tool fields and preserves the tool call request id', async () => {
    const instance = await createTestSandbox()
    const tool = createExecTool({ sandbox: instance })
    const result = await tool.execute({ command: 'printf \'hello\'', yield_time_ms: 500 }, EXECUTE_OPTIONS)

    expect(result).toMatchObject({
      requestId: 'tool-call-1',
      running: false,
      stdout: 'hello',
    })
  })

  it('applies standard git add, rename, update, and delete patches through the sandbox', async () => {
    const instance = await createTestSandbox()
    const tool = createApplyPatchTool({ sandbox: instance })

    const added = await tool.execute({
      cwd: testDir,
      patch: `diff --git a/note.txt b/note.txt
new file mode 100644
--- /dev/null
+++ b/note.txt
@@ -0,0 +1 @@
+first
`,
    }, EXECUTE_OPTIONS)
    expect(added).toMatchObject({ exitCode: 0 })
    expect(await readFile(join(testDir!, 'note.txt'), 'utf8')).toBe('first\n')

    const moved = await tool.execute({
      cwd: testDir,
      patch: `diff --git a/note.txt b/result.txt
similarity index 50%
rename from note.txt
rename to result.txt
--- a/note.txt
+++ b/result.txt
@@ -1 +1 @@
-first
+second
`,
    }, EXECUTE_OPTIONS)
    expect(moved).toMatchObject({ exitCode: 0 })
    expect(await readFile(join(testDir!, 'result.txt'), 'utf8')).toBe('second\n')
    await expect(readFile(join(testDir!, 'note.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const deleted = await tool.execute({
      cwd: testDir,
      patch: `diff --git a/result.txt b/result.txt
deleted file mode 100644
--- a/result.txt
+++ /dev/null
@@ -1 +0,0 @@
-second
`,
    }, EXECUTE_OPTIONS)
    expect(deleted).toMatchObject({ exitCode: 0 })
    await expect(readFile(join(testDir!, 'result.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects patch paths outside the working directory', async () => {
    const instance = await createTestSandbox()
    const tool = createApplyPatchTool({ sandbox: instance })
    const result = await tool.execute({
      cwd: testDir,
      patch: `diff --git a/../escaped.txt b/../escaped.txt
new file mode 100644
--- /dev/null
+++ b/../escaped.txt
@@ -0,0 +1 @@
+escaped
`,
    }, EXECUTE_OPTIONS)

    expect(result).not.toMatchObject({ exitCode: 0 })
    expect(result).toMatchObject({ stderr: 'error: invalid path \'../escaped.txt\'\n' })
  })
})

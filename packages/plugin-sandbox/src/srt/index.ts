import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

import type {
  BackendStartOptions,
  ProcessSink,
  RunningProcess,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxProfile,
} from '../types'

import process from 'node:process'

import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
} from '@anthropic-ai/sandbox-runtime'

import { startNodeProcess } from '../process'
import { SandboxError } from '../sandbox'

export interface SrtAdapterOptions {
  bwrapPath?: string
  enableLogMonitor?: boolean
  enableWeakerNestedSandbox?: boolean
  mandatoryDenySearchDepth?: number
  ripgrep?: {
    args?: string[]
    command: string
  }
  socatPath?: string
}

const adapterState: { active?: symbol } = {}
const alphabetical = (left: string, right: string) => left.localeCompare(right)

const toSrtConfig = (
  profile: Readonly<SandboxProfile>,
  options: SrtAdapterOptions,
): SandboxRuntimeConfig => SandboxRuntimeConfigSchema.parse({
  bwrapPath: options.bwrapPath,
  enableWeakerNestedSandbox: options.enableWeakerNestedSandbox,
  filesystem: {
    allowRead: profile.fileSystem.allowRead,
    allowWrite: profile.fileSystem.allowWrite,
    denyRead: profile.fileSystem.denyRead,
    denyWrite: profile.fileSystem.denyWrite,
  },
  mandatoryDenySearchDepth: options.mandatoryDenySearchDepth,
  network: {
    allowedDomains: profile.network.allowedDomains,
    allowLocalBinding: profile.network.allowLocalBinding,
    allowUnixSockets: profile.network.allowUnixSockets,
    deniedDomains: profile.network.deniedDomains,
    strictAllowlist: true,
  },
  ripgrep: options.ripgrep,
  socatPath: options.socatPath,
})

const sameNetworkPolicy = (
  left: Readonly<SandboxProfile['network']>,
  right: Readonly<SandboxProfile['network']>,
) => JSON.stringify({
  ...left,
  allowedDomains: [...left.allowedDomains].sort(alphabetical),
  allowUnixSockets: [...left.allowUnixSockets].sort(alphabetical),
  deniedDomains: [...left.deniedDomains].sort(alphabetical),
}) === JSON.stringify({
  ...right,
  allowedDomains: [...right.allowedDomains].sort(alphabetical),
  allowUnixSockets: [...right.allowUnixSockets].sort(alphabetical),
  deniedDomains: [...right.deniedDomains].sort(alphabetical),
})

export const createSrtAdapter = (options: SrtAdapterOptions = {}): SandboxAdapter => {
  const instance = Symbol('apeira-srt-adapter')
  let disposed = false
  let initialized = false
  let initialization: Promise<void> | undefined
  let networkProfile: Readonly<SandboxProfile['network']> | undefined

  const check = async (): Promise<SandboxCapabilityReport> => {
    if (process.platform !== 'linux') {
      return {
        errors: ['@apeira/plugin-sandbox/srt currently supports Linux only.'],
        platform: process.platform,
        supported: false,
        warnings: [],
      }
    }

    const dependencies = SandboxManager.checkDependencies(options.ripgrep)
    return {
      errors: dependencies.errors,
      platform: process.platform,
      supported: dependencies.errors.length === 0,
      warnings: dependencies.warnings,
    }
  }

  const initialize = async (profile: Readonly<SandboxProfile>) => {
    if (disposed)
      throw new SandboxError('disposed', 'SRT adapter has been disposed.')
    if (initialized)
      return
    if (initialization != null)
      return initialization
    if (adapterState.active != null && adapterState.active !== instance) {
      throw new SandboxError(
        'adapter_unavailable',
        'SRT is process-global and another @apeira/plugin-sandbox SRT adapter is already active.',
      )
    }

    adapterState.active = instance
    networkProfile = structuredClone(profile.network)
    initialization = (async () => {
      const capabilities = await check()
      if (!capabilities.supported) {
        throw new SandboxError(
          'adapter_unavailable',
          `SRT is unavailable: ${capabilities.errors.join(', ')}`,
          { capabilities },
        )
      }

      await SandboxManager.initialize(
        toSrtConfig(profile, options),
        undefined,
        options.enableLogMonitor,
      )
      initialized = true
    })()
    try {
      await initialization
    }
    catch (error) {
      if (adapterState.active === instance)
        adapterState.active = undefined
      networkProfile = undefined
      initialization = undefined
      throw error
    }
  }

  const start = async (
    request: BackendStartOptions,
    profile: Readonly<SandboxProfile>,
    sink: ProcessSink,
  ): Promise<RunningProcess> => {
    await initialize(profile)
    if (disposed)
      throw new SandboxError('disposed', 'SRT adapter has been disposed.')

    // SRT's proxy policy is process-global. Per-command filesystem profiles are
    // supported, but widening network access for one concurrent command would
    // widen it for every command. Reject that unsafe shape instead.
    if (networkProfile == null || !sameNetworkPolicy(networkProfile, profile.network)) {
      throw new SandboxError(
        'adapter_unavailable',
        'The SRT adapter cannot change network policy per process. Configure a fixed network policy or request an explicit host bypass.',
      )
    }

    const shell = request.shell ?? process.env.SHELL ?? '/bin/bash'
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      request.command,
      shell,
      toSrtConfig(profile, options),
      request.signal,
      request.cwd,
    )
    const processHandle = startNodeProcess(
      wrapped.argv as [string, ...string[]],
      request,
      sink,
      { ...wrapped.env, ...request.env },
    )

    return {
      ...processHandle,
      completed: processHandle.completed.then((exit) => {
        SandboxManager.cleanupAfterCommand()
        return exit
      }, (error) => {
        SandboxManager.cleanupAfterCommand()
        throw error
      }),
    }
  }

  const dispose = async () => {
    if (disposed)
      return
    disposed = true
    await initialization?.catch(() => undefined)
    try {
      if (initialized)
        await SandboxManager.reset()
    }
    finally {
      initialized = false
      networkProfile = undefined
      if (adapterState.active === instance)
        adapterState.active = undefined
    }
  }

  return {
    check,
    dispose,
    name: 'srt',
    start,
  }
}

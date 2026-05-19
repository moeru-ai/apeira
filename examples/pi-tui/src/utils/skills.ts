import type { Dirent } from 'node:fs'

import type { Skill, SkillDiagnostic, SkillReference, SkillsRegistrySnapshot } from '@apeira/plugin-skills'

import fs from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from './config'

interface SkillFrontmatter {
  description?: string
  disableModelInvocation?: boolean
  name?: string
}

export const skillsDir = path.join(workspaceRoot, '.agents', 'skills')
const REFERENCE_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])

const parseScalar = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

const parseBoolean = (value: string): boolean | undefined => {
  const trimmed = value.trim()
  if (trimmed === 'true')
    return true

  if (trimmed === 'false')
    return false
}

const parseFrontmatter = (content: string): { body: string, frontmatter: SkillFrontmatter } => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---\n'))
    return { body: normalized.trim(), frontmatter: {} }

  const endIndex = normalized.indexOf('\n---', 4)
  if (endIndex === -1)
    return { body: normalized.trim(), frontmatter: {} }

  const frontmatter: SkillFrontmatter = {}
  const yaml = normalized.slice(4, endIndex)

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#'))
      continue

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1)
      continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = parseScalar(trimmed.slice(separatorIndex + 1))

    if (key === 'name' && typeof value === 'string')
      frontmatter.name = value
    else if (key === 'description' && typeof value === 'string')
      frontmatter.description = value
    else if (key === 'disable-model-invocation')
      frontmatter.disableModelInvocation = parseBoolean(trimmed.slice(separatorIndex + 1))
  }

  return {
    body: normalized.slice(endIndex + 4).trim(),
    frontmatter,
  }
}

const isValidSkillName = (name: string) => {
  for (const character of name) {
    const isLowercaseLetter = character >= 'a' && character <= 'z'
    const isDigit = character >= '0' && character <= '9'
    if (!isLowercaseLetter && !isDigit && character !== '-')
      return false
  }

  return name.length > 0
}

const validateSkill = (skill: Skill): SkillDiagnostic[] => {
  const diagnostics: SkillDiagnostic[] = []
  const parentName = path.basename(path.dirname(skill.filePath))

  if (skill.description.trim().length === 0) {
    diagnostics.push({
      code: 'invalid_metadata',
      message: 'description is required',
      path: skill.filePath,
      type: 'warning',
    })
  }

  if (skill.name !== parentName) {
    diagnostics.push({
      code: 'invalid_metadata',
      message: `name "${skill.name}" does not match parent directory "${parentName}"`,
      path: skill.filePath,
      type: 'warning',
    })
  }

  if (!isValidSkillName(skill.name)) {
    diagnostics.push({
      code: 'invalid_metadata',
      message: 'name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)',
      path: skill.filePath,
      type: 'warning',
    })
  }

  return diagnostics
}

const collectReferenceFiles = async (
  directory: string,
  diagnostics: SkillDiagnostic[],
): Promise<string[]> => {
  let entries: Dirent[]

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  }
  catch (error) {
    diagnostics.push({
      code: 'list_failed',
      message: error instanceof Error ? error.message : String(error),
      path: directory,
      type: 'warning',
    })
    return []
  }

  const files: string[] = []

  for (const entry of entries.slice().sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectReferenceFiles(absolutePath, diagnostics))
      continue
    }

    if (entry.isFile() && REFERENCE_EXTENSIONS.has(path.extname(entry.name)))
      files.push(absolutePath)
  }

  return files
}

const readSkillReferences = async (skillDir: string): Promise<{ diagnostics: SkillDiagnostic[], references: SkillReference[] }> => {
  const diagnostics: SkillDiagnostic[] = []
  const references: SkillReference[] = []
  const referencesDir = path.join(skillDir, 'references')

  try {
    const stat = await fs.stat(referencesDir)
    if (!stat.isDirectory())
      return { diagnostics, references }
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { diagnostics, references }

    diagnostics.push({
      code: 'list_failed',
      message: error instanceof Error ? error.message : String(error),
      path: referencesDir,
      type: 'warning',
    })
    return { diagnostics, references }
  }

  for (const absolutePath of await collectReferenceFiles(referencesDir, diagnostics)) {
    const relativePath = path.relative(skillDir, absolutePath)

    references.push({ path: relativePath })
  }

  references.sort((left, right) => left.path.localeCompare(right.path))
  return { diagnostics, references }
}

const readSkillEntry = async (entry: Dirent): Promise<SkillsRegistrySnapshot> => {
  const skills: Skill[] = []
  const diagnostics: SkillDiagnostic[] = []

  if (!entry.isDirectory() || entry.name.startsWith('.'))
    return { diagnostics, skills }

  const filePath = path.join(skillsDir, entry.name, 'SKILL.md')
  const skillDir = path.dirname(filePath)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = parseFrontmatter(content)
    const referenceResult = await readSkillReferences(skillDir)
    const skill: Skill = {
      content: parsed.body,
      description: parsed.frontmatter.description ?? '',
      disableModelInvocation: parsed.frontmatter.disableModelInvocation,
      filePath,
      name: parsed.frontmatter.name ?? entry.name,
      references: referenceResult.references,
      source: 'project',
    }
    const skillDiagnostics = validateSkill(skill)

    diagnostics.push(...skillDiagnostics)
    diagnostics.push(...referenceResult.diagnostics)

    if (skillDiagnostics.length === 0)
      skills.push(skill)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { diagnostics, skills }

    diagnostics.push({
      code: 'read_failed',
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
      type: 'warning',
    })
  }

  return { diagnostics, skills }
}

export const loadWorkspaceSkills = async (): Promise<SkillsRegistrySnapshot> => {
  const skills: Skill[] = []
  const diagnostics: SkillDiagnostic[] = []

  let entries: Dirent[]

  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true })
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { diagnostics, skills }

    diagnostics.push({
      code: 'list_failed',
      message: error instanceof Error ? error.message : String(error),
      path: skillsDir,
      type: 'warning',
    })
    return { diagnostics, skills }
  }

  const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of sortedEntries) {
    const result = await readSkillEntry(entry)
    skills.push(...result.skills)
    diagnostics.push(...result.diagnostics)
  }

  return { diagnostics, skills }
}

export const loadWorkspaceSkillReference = async (skill: Skill, referencePath: string) => {
  const skillDir = path.dirname(skill.filePath)
  const absolutePath = path.resolve(skillDir, referencePath)
  const relativePath = path.relative(skillDir, absolutePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath))
    return undefined

  return fs.readFile(absolutePath, 'utf8')
}

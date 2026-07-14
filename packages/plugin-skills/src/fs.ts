import type { Dirent } from 'node:fs'

import type { Skill, SkillDiagnostic, SkillReference, SkillSet, SkillSetSnapshot } from './types/index'

import fs from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

export interface FSSkillSetOptions {
  /** Allowed reference file extensions. Defaults to ['.md', '.mdx', '.txt']. */
  allowedReferenceExtensions?: string[]
  /** Base directory containing skill subdirectories. */
  directory: string
  /** Priority for deduplication when merged with other skill sets. Higher wins. */
  priority?: number
}

const parseFrontmatter = <T>(content: string): { attrs?: T, body: string } => {
  const opening = /^\uFEFF?---[^\S\r\n]*\n/.exec(content)
  if (opening == null)
    return { attrs: undefined, body: content.trim() }

  const bodyStart = opening[0].length
  const closing = /\n---[^\S\r\n]*(?:\n|$)/.exec(content.slice(bodyStart))
  if (closing == null)
    return { attrs: undefined, body: content.trim() }

  let attrs: T | undefined
  try {
    attrs = parse(content.slice(bodyStart, bodyStart + closing.index)) as T
  }
  catch {}

  return { attrs, body: content.slice(bodyStart + closing.index + closing[0].length).trim() }
}

const normalizeReferencePath = (value: string) =>
  value.replace(/\\/g, '/')

const collectReferenceFiles = async (
  directory: string,
  allowedExtensions: string[],
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
      files.push(...await collectReferenceFiles(absolutePath, allowedExtensions, diagnostics))
      continue
    }

    if (entry.isFile() && allowedExtensions.includes(path.extname(entry.name)))
      files.push(absolutePath)
  }

  return files
}

const readSkillReferences = async (
  skillDir: string,
  allowedExtensions: string[],
): Promise<{ diagnostics: SkillDiagnostic[], references: SkillReference[] }> => {
  const diagnostics: SkillDiagnostic[] = []
  const references: SkillReference[] = []
  const referencesDir = path.join(skillDir, 'references')

  try {
    const stat = await fs.stat(referencesDir)

    if (!stat.isDirectory())
      return { diagnostics, references }
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { diagnostics, references }

    diagnostics.push({
      code: 'list_failed',
      message: error instanceof Error ? error.message : String(error),
      path: referencesDir,
      type: 'warning',
    })
    return { diagnostics, references }
  }

  for (const absolutePath of await collectReferenceFiles(referencesDir, allowedExtensions, diagnostics)) {
    const relativePath = normalizeReferencePath(path.relative(skillDir, absolutePath))

    references.push({ path: relativePath })
  }

  references.sort((left, right) => left.path.localeCompare(right.path))
  return { diagnostics, references }
}

const readSkillEntry = async (
  baseDirectory: string,
  entryName: string,
  allowedExtensions: string[],
): Promise<SkillSetSnapshot> => {
  const skills: Skill[] = []
  const diagnostics: SkillDiagnostic[] = []
  const filePath = path.join(baseDirectory, entryName, 'SKILL.md')
  const skillDir = path.dirname(filePath)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const { attrs, body } = parseFrontmatter<{ description?: string, name?: string }>(content)
    const referenceResult = await readSkillReferences(skillDir, allowedExtensions)

    skills.push({
      content: body,
      description: attrs?.description ?? '',
      filePath,
      name: attrs?.name ?? entryName,
      references: referenceResult.references,
    })
    diagnostics.push(...referenceResult.diagnostics)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
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

/**
 * Creates a skill set that reads skills from a filesystem directory.
 *
 * Each skill is expected to be in a subdirectory: `<directory>/<skill-name>/SKILL.md`
 * with optional YAML frontmatter (`name`, `description`) and an optional `references/` subdirectory.
 */
export const fsSkillSet = (options: FSSkillSetOptions): SkillSet => {
  const { allowedReferenceExtensions = ['.md', '.mdx', '.txt'], directory, priority } = options

  let snapshot: SkillSetSnapshot = { diagnostics: [], skills: [] }

  const refresh = async () => {
    const skills: Skill[] = []
    const diagnostics: SkillDiagnostic[] = []

    let entries: Dirent[]

    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
        return { diagnostics: [], skills: [] }

      diagnostics.push({
        code: 'list_failed',
        message: error instanceof Error ? error.message : String(error),
        path: directory,
        type: 'warning',
      })
      snapshot = { diagnostics: diagnostics.slice(), skills: [] }
      return { diagnostics: diagnostics.slice(), skills: [] }
    }

    const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of sortedEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.'))
        continue

      const result = await readSkillEntry(directory, entry.name, allowedReferenceExtensions)

      skills.push(...result.skills)
      diagnostics.push(...result.diagnostics)
    }

    snapshot = { diagnostics, skills }
    return { diagnostics: diagnostics.slice(), skills: skills.slice() }
  }

  const getSkillReference = async (skillName: string, referencePath: string) => {
    const skill = snapshot.skills.find(candidate => candidate.name === skillName)

    if (skill == null)
      return undefined

    const normalizedReferencePath = normalizeReferencePath(referencePath)
    const reference = skill.references?.find(candidate => candidate.path === normalizedReferencePath)

    if (reference == null)
      return undefined

    if (reference.content != null)
      return reference

    const skillDir = path.dirname(skill.filePath)
    const absolutePath = path.resolve(skillDir, normalizedReferencePath)
    const relativePath = path.relative(skillDir, absolutePath)

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath))
      return undefined

    try {
      const content = await fs.readFile(absolutePath, 'utf8')

      return { ...reference, content }
    }
    catch {
      return undefined
    }
  }

  return {
    getDiagnostics: () => snapshot.diagnostics.slice(),
    getSkill: skillName => snapshot.skills.find(skill => skill.name === skillName),
    getSkillReference,
    getSkills: () => snapshot.skills.slice(),
    priority,
    refresh,
  }
}

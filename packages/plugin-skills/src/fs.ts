import type { Dirent } from 'node:fs'

import type { Skill, SkillDiagnostic, SkillReference, SkillSet, SkillSetSnapshot } from './index'

import fs from 'node:fs/promises'
import path from 'node:path'

export interface FSSkillSetOptions {
  /** Allowed reference file extensions. Defaults to ['.md', '.mdx', '.txt']. */
  allowedReferenceExtensions?: string[]
  /** Base directory containing skill subdirectories. */
  directory: string
  /** Priority for deduplication when merged with other skill sets. Higher wins. */
  priority?: number
}

interface SkillFrontmatter {
  description?: string
  name?: string
}

const parseFrontmatter = (content: string): { body: string, frontmatter: SkillFrontmatter } => {
  const frontmatter: SkillFrontmatter = {}

  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content)

  if (match == null)
    return { body: content.trim(), frontmatter }

  for (const line of match[1].split('\n')) {
    if (line.startsWith('name:'))
      frontmatter.name = line.slice(5).trim()
    else if (line.startsWith('description:'))
      frontmatter.description = line.slice(12).trim()
  }

  return {
    body: content.slice(match[0].length).trim(),
    frontmatter,
  }
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
    const parsed = parseFrontmatter(content)
    const referenceResult = await readSkillReferences(skillDir, allowedExtensions)

    skills.push({
      content: parsed.body,
      description: parsed.frontmatter.description ?? '',
      filePath,
      name: parsed.frontmatter.name ?? entryName,
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

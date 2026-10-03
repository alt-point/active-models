export const PACKAGE: string
export const EXPORT_MAP: Record<string, string>
export const DEFAULT_EXTENSIONS: string[]
export const DEFAULT_IGNORE: string[]

export type Change = { line: number, before: string, after: string }
export type Warning = { line: number, message: string }
export type MigrateResult = { code: string, changes: Change[], warnings: Warning[] }

export function maskCode (source: string): string
export function migrateSource (source: string, options?: { api?: boolean }): MigrateResult
export function migrateVue (source: string, options?: { api?: boolean }): MigrateResult
export function collectFiles (paths: string[], options?: { extensions?: string[], ignore?: string[] }): string[]
export function migratePaths (
  paths: string[],
  options?: { write?: boolean, api?: boolean, extensions?: string[], ignore?: string[], cwd?: string }
): { files: Array<{ file: string, changes: Change[], warnings: Warning[], changed: boolean }>, scanned: number }

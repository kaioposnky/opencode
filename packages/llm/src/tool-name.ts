/**
 * Resolves a canonical tool name from an exact match or an unambiguous
 * provider-truncated prefix. Some providers drop the final character of
 * streamed tool names (e.g. advertised `read` arrives as `rea`); recover the
 * intended tool when exactly one candidate completes the truncated name,
 * preferring a unique one-character completion over a longer unique prefix.
 */
export function resolveToolNameByUniquePrefix(toolNames: readonly string[], name: string): string | undefined {
  const uniqueToolNames = [...new Set(toolNames)]
  if (uniqueToolNames.includes(name)) return name
  if (name.length < 3) return undefined
  const prefixMatches = uniqueToolNames.filter((candidate) => candidate.startsWith(name))
  const oneCharacterCompletions = prefixMatches.filter((candidate) => candidate.length === name.length + 1)
  if (oneCharacterCompletions.length === 1) return oneCharacterCompletions[0]
  return prefixMatches.length === 1 ? prefixMatches[0] : undefined
}

/**
 * Canonicalizes a provider-issued tool-call name against the executable tool
 * set: exact names pass through unchanged, truncated names recover their
 * intended tool, and unknown names are returned untouched.
 */
export function canonicalizeToolCallName(advertisedToolNames: readonly string[], name: string): string {
  return resolveToolNameByUniquePrefix(advertisedToolNames, name) ?? name
}

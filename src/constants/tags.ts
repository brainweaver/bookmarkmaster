export const SYSTEM_TAG_NOT_REACHABLE = "__not_reachable__";

export function isSystemTag(tag: string): boolean {
  return tag === SYSTEM_TAG_NOT_REACHABLE;
}

export function visibleTags(tags: string[]): string[] {
  return tags.filter((t) => !isSystemTag(t));
}

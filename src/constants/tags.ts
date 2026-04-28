export const SYSTEM_TAG_NOT_REACHABLE = "__not_reachable__";
export const SYSTEM_TAG_NOT_UNIQUE = "__not_unique__";
export const SYSTEM_TAG_ARCHIVED = "__archived__";

export function isSystemTag(tag: string): boolean {
  return tag === SYSTEM_TAG_NOT_REACHABLE || tag === SYSTEM_TAG_NOT_UNIQUE || tag === SYSTEM_TAG_ARCHIVED;
}

export function visibleTags(tags: string[]): string[] {
  return tags.filter((t) => !isSystemTag(t));
}

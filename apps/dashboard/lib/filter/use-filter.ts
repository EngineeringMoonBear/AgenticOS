"use client";

import { useQueryState, createParser } from "nuqs";
import { serializeFilter, parseFilter } from "./codec";

const filterParser = createParser<string[]>({
  parse: (value: string) => parseFilter(value),
  serialize: (value: string[]) => serializeFilter(value),
})
  .withDefault([])
  .withOptions({ history: "push", shallow: false });

/**
 * Hook that syncs the global filter state with the URL ?filter= param.
 *
 * @returns tags — current active tag slugs (empty = "All")
 * @returns setTags — replace the full tag list
 * @returns toggleTag — add or remove a single tag
 * @returns clear — remove all tags (removes param from URL)
 */
export function useFilter() {
  const [tags, setTags] = useQueryState("filter", filterParser);

  const activeTags = tags ?? [];

  function toggleTag(tag: string) {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
    setTags(next);
  }

  function clear() {
    setTags([]);
  }

  return {
    tags: activeTags,
    setTags: (next: string[]) => setTags(next),
    toggleTag,
    clear,
  };
}

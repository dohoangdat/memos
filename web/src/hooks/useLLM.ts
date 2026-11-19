import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import { forkFetch } from "@/lib/fork-api";

/** What the LLM features can do for the current user (server/llm). */
export interface LLMFeatureState {
  suggestTags: boolean;
  voiceNote: boolean;
  voiceTags: boolean;
  transcribe: boolean;
  /** Admins only: the configuration and the providers to choose from. */
  config?: LLMFeatures;
  providers?: { id: string; title: string; type: string; keySet: boolean }[];
}

export interface LLMFeatures {
  suggestTags: { enabled: boolean; providerId: string; model: string; prompt: string; maxTags: number; allowNew: boolean };
  voiceNote: { enabled: boolean; autoTags: boolean };
}

export interface TagSuggestion {
  tag: string;
  existing: boolean;
}

export const llmKeys = { features: ["llm-features"] as const };

export function useLLMFeatures() {
  const currentUser = useCurrentUser();
  return useQuery({
    queryKey: llmKeys.features,
    enabled: Boolean(currentUser),
    staleTime: 5 * 60_000,
    queryFn: () => forkFetch<LLMFeatureState>("/api/x/llm/features"),
  });
}

export function useSaveLLMFeatures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (features: LLMFeatures) => forkFetch<LLMFeatures>("/api/x/llm/features", { method: "PUT", body: features }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: llmKeys.features }),
  });
}

/** Tags the LLM suggests for a memo's text, preferring the user's existing tags. */
export const suggestTags = async (content: string): Promise<TagSuggestion[]> =>
  (await forkFetch<{ tags: TagSuggestion[] }>("/api/x/llm/suggest-tags", { method: "POST", body: { content } })).tags;

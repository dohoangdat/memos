import { Button, Checkbox, Field, Input, Select, Textarea } from "@usememos/ui";
import { useEffect, useState } from "react";
import { type LLMFeatures, useLLMFeatures, useSaveLLMFeatures } from "@/hooks/useLLM";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

const NONE = "__none__";

const Toggle = ({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) => (
  <label className="flex cursor-pointer items-start gap-2">
    <Checkbox checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    <span className="flex flex-col">
      <span className="mu-body text-mu-text">{label}</span>
      {description && <span className="mu-caption text-mu-text-secondary">{description}</span>}
    </span>
  </label>
);

/**
 * The LLM features (fork, server/llm): what is on, and which of the instance's AI providers
 * (Settings → AI, where the API keys are entered) each one uses. Admins only.
 */
const LLMFeaturesSection = () => {
  const t = useTranslate();
  const { data } = useLLMFeatures();
  const save = useSaveLLMFeatures();
  const [draft, setDraft] = useState<LLMFeatures | null>(null);

  useEffect(() => {
    if (data?.config && !draft) setDraft(data.config);
  }, [data, draft]);

  if (!draft) {
    return (
      <SettingSection title={t("setting.llm.label")} description={t("llm.section-description")}>
        {null}
      </SettingSection>
    );
  }
  const providers = data?.providers ?? [];
  const items = [
    { value: NONE, label: t("llm.no-provider") },
    ...providers.map((provider) => ({ value: provider.id, label: `${provider.title} (${provider.type})` })),
  ];
  const chosen = providers.find((provider) => provider.id === draft.suggestTags.providerId);
  const setSuggest = (patch: Partial<LLMFeatures["suggestTags"]>) =>
    setDraft({ ...draft, suggestTags: { ...draft.suggestTags, ...patch } });
  const setVoice = (patch: Partial<LLMFeatures["voiceNote"]>) => setDraft({ ...draft, voiceNote: { ...draft.voiceNote, ...patch } });

  const submit = async () => {
    try {
      setDraft(await save.mutateAsync(draft));
      toast.add({ title: t("llm.saved"), type: "success" });
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    }
  };

  return (
    <SettingSection title={t("setting.llm.label")} description={t("llm.section-description")}>
      <SettingGroup title={t("llm.suggest-tags")} description={t("llm.suggest-tags-description")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle checked={draft.suggestTags.enabled} onChange={(enabled) => setSuggest({ enabled })} label={t("llm.enable")} />
          </div>
          <Field.Root className="sm:col-span-2">
            <Field.Label>{t("llm.provider")}</Field.Label>
            <Select.Root
              value={draft.suggestTags.providerId || NONE}
              items={items}
              onValueChange={(value) => setSuggest({ providerId: !value || value === NONE ? "" : String(value) })}
            >
              <Select.Trigger className="w-full">
                <Select.Value />
              </Select.Trigger>
              <Select.Popup>
                {items.map((item) => (
                  <Select.Item key={item.value} value={item.value}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Field.Description>{providers.length === 0 ? t("llm.no-providers") : t("llm.provider-help")}</Field.Description>
            {chosen && !chosen.keySet && <p className="mu-caption text-mu-danger">{t("llm.no-key")}</p>}
          </Field.Root>
          <Field.Root>
            <Field.Label>{t("llm.model")}</Field.Label>
            <Input
              value={draft.suggestTags.model}
              placeholder="gpt-4o-mini / gemini-2.5-flash"
              onChange={(event) => setSuggest({ model: event.target.value })}
            />
            <Field.Description>{t("llm.model-help")}</Field.Description>
          </Field.Root>
          <Field.Root>
            <Field.Label>{t("llm.max-tags")}</Field.Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={String(draft.suggestTags.maxTags)}
              onChange={(event) => setSuggest({ maxTags: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })}
            />
          </Field.Root>
          <div className="sm:col-span-2">
            <Toggle
              checked={draft.suggestTags.allowNew}
              onChange={(allowNew) => setSuggest({ allowNew })}
              label={t("llm.allow-new")}
              description={t("llm.allow-new-help")}
            />
          </div>
          <Field.Root className="sm:col-span-2">
            <Field.Label>{t("llm.prompt")}</Field.Label>
            <Textarea
              rows={3}
              value={draft.suggestTags.prompt}
              placeholder={t("llm.prompt-placeholder")}
              onChange={(event) => setSuggest({ prompt: event.target.value })}
            />
          </Field.Root>
        </div>
      </SettingGroup>

      <SettingGroup title={t("llm.voice-note")} description={t("llm.voice-note-description")}>
        <div className="flex flex-col gap-3">
          <Toggle checked={draft.voiceNote.enabled} onChange={(enabled) => setVoice({ enabled })} label={t("llm.enable")} />
          <Toggle checked={draft.voiceNote.autoTags} onChange={(autoTags) => setVoice({ autoTags })} label={t("llm.voice-auto-tags")} />
          {!data?.transcribe && <p className="mu-caption text-mu-danger">{t("llm.transcription-off")}</p>}
        </div>
      </SettingGroup>

      <div>
        <Button variant="primary" onClick={() => void submit()} loading={save.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </SettingSection>
  );
};

export default LLMFeaturesSection;

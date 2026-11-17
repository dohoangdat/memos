import { Switch } from "@usememos/ui";
import { updateDevicePreferences, useDevicePreferences } from "@/hooks/useDevicePreferences";
import { useSourceMode } from "@/hooks/useSourceMode";
import { useTranslate } from "@/utils/i18n";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

const EditorSection = () => {
  const t = useTranslate();
  const [editorMode, setEditorMode] = useSourceMode();
  const { classicEditor } = useDevicePreferences();

  return (
    <SettingSection title={t("setting.editor.label")}>
      <SettingList aria-label={t("setting.editor.label")}>
        <SettingListItem label={t("editor.markdown-mode")} description={t("setting.editor.markdown-mode-description")}>
          <Switch
            aria-label={t("editor.markdown-mode")}
            checked={editorMode === "source" && !classicEditor}
            onCheckedChange={(checked) => {
              if (checked) updateDevicePreferences({ classicEditor: false });
              setEditorMode(checked ? "source" : "rich");
            }}
          />
        </SettingListItem>
        <SettingListItem label={t("editor.classic-mode")} description={t("setting.editor.classic-mode-description")}>
          <Switch
            aria-label={t("editor.classic-mode")}
            checked={classicEditor}
            onCheckedChange={(checked) => updateDevicePreferences({ classicEditor: checked })}
          />
        </SettingListItem>
      </SettingList>
    </SettingSection>
  );
};

export default EditorSection;

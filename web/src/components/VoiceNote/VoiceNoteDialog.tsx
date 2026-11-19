import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Spinner, Textarea } from "@usememos/ui";
import { CheckIcon, HashIcon, MicIcon, PauseIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transcriptionService } from "@/components/MemoEditor/edit/services/transcriptionService";
import { uploadService } from "@/components/MemoEditor/edit/services/uploadService";
import { attachmentServiceClient, memoServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveFilterTag } from "@/contexts/MemoFilterContext";
import { useBackToClose } from "@/hooks/useBackToClose";
import { suggestTags, useLLMFeatures } from "@/hooks/useLLM";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import { AttachmentSchema } from "@/types/proto/api/attachment_service_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { convertVisibilityFromString } from "@/utils/memo";
import { addTagToMarkdown } from "@/utils/memo-tags-markdown";

type Step = "idle" | "recording" | "paused" | "processing" | "review";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const pickMime = () =>
  typeof MediaRecorder === "undefined" ? undefined : MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
const extensionOf = (mime: string) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * A voice note from the ＋ button (fork): one tap starts recording, the same button pauses and
 * resumes, Done finishes. The recording is uploaded and kept as the memo's attachment; its text
 * comes from the instance's speech-to-text, and tags from the LLM, both shown for review before
 * the memo is saved.
 */
const VoiceNoteBody = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { userGeneralSetting } = useAuth();
  const filterTag = useActiveFilterTag();
  const { data: llm } = useLLMFeatures();
  const [step, setStep] = useState<Step>("idle");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<{ tag: string; on: boolean; existing: boolean }[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const saved = useRef(false);
  const attachmentRef = useRef<Attachment | null>(null);
  attachmentRef.current = attachment;
  useBackToClose(onClose);

  useEffect(() => {
    if (step !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  // Leaving without saving drops the uploaded recording and releases the microphone.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      if (attachmentRef.current && !saved.current)
        void attachmentServiceClient.deleteAttachment({ name: attachmentRef.current.name }).catch(() => undefined);
    },
    [],
  );

  const start = async () => {
    const mimeType = pickMime();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      showErrorToast(t("voice-note.unsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      media.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
      media.start(1000);
      recorder.current = media;
      setStep("recording");
    } catch {
      showErrorToast(t("voice-note.no-microphone"));
    }
  };

  const toggle = () => {
    const media = recorder.current;
    if (step === "idle") return void start();
    if (!media) return;
    if (step === "recording") {
      media.pause();
      setStep("paused");
    } else if (step === "paused") {
      media.resume();
      setStep("recording");
    }
  };

  const finish = async () => {
    const media = recorder.current;
    if (!media) return;
    const stopped = new Promise<void>((resolve) => {
      media.onstop = () => resolve();
    });
    media.stop();
    await stopped;
    media.stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks.current, { type: media.mimeType });
    if (blob.size === 0) {
      showErrorToast(t("voice-note.empty"));
      setStep("idle");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const file = new File([blob], `voice-note-${stamp}.${extensionOf(media.mimeType)}`, { type: media.mimeType.split(";")[0] });
    setAudioUrl(URL.createObjectURL(blob));
    setStep("processing");
    try {
      setStatus(t("voice-note.uploading"));
      const uploading = uploadService.uploadFile({
        file,
        previewUrl: "",
        origin: "audio_recording",
        audioMeta: { durationSeconds: seconds },
      });
      let transcript = "";
      if (llm?.transcribe) {
        setStatus(t("voice-note.transcribing"));
        transcript = await transcriptionService.transcribeFile(file).catch((error: unknown) => {
          showErrorToast(`${t("voice-note.transcribe-failed")}: ${error instanceof Error ? error.message : ""}`);
          return "";
        });
      }
      setText(transcript);
      if (transcript.trim() && llm?.voiceTags) {
        setStatus(t("llm.suggesting"));
        const suggestions = await suggestTags(transcript).catch(() => []);
        setTags(suggestions.map((item) => ({ ...item, on: true })));
      }
      setAttachment(await uploading);
      setStep("review");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
      setStep("idle");
    }
  };

  const save = async () => {
    if (!attachment) return;
    setSaving(true);
    try {
      let content = text.trim();
      for (const item of tags) if (item.on) content = addTagToMarkdown(content, item.tag);
      if (filterTag) content = addTagToMarkdown(content, filterTag);
      const visibility = userGeneralSetting?.memoVisibility
        ? convertVisibilityFromString(userGeneralSetting.memoVisibility)
        : Visibility.PRIVATE;
      await memoServiceClient.createMemo({
        memo: create(MemoSchema, { content, visibility, attachments: [create(AttachmentSchema, { name: attachment.name })] }),
      });
      saved.current = true;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
      ]);
      toast.add({ title: t("voice-note.saved"), type: "success" });
      onClose();
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    } finally {
      setSaving(false);
    }
  };

  if (step === "processing") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-mu-text-secondary">
        <Spinner />
        <span className="mu-body">{status}</span>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="flex flex-col gap-3">
        <audio src={audioUrl} controls className="w-full" />
        <Textarea
          rows={6}
          value={text}
          placeholder={llm?.transcribe ? t("voice-note.no-text") : t("voice-note.transcription-off")}
          onChange={(event) => setText(event.target.value)}
          aria-label={t("voice-note.text")}
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={t("llm.suggest-tags")}>
            {tags.map((item, index) => (
              <button
                key={item.tag}
                type="button"
                aria-pressed={item.on}
                onClick={() => setTags(tags.map((other, at) => (at === index ? { ...other, on: !other.on } : other)))}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-mu-md border px-2 py-1 mu-caption mu-focus",
                  item.on ? "border-mu-primary/40 bg-mu-primary/10 text-mu-text" : "border-mu-line text-mu-text-secondary line-through",
                )}
              >
                <HashIcon className="mu-icon-xs opacity-60" />
                {item.tag}
                {!item.existing && <span className="ms-1 opacity-60">{t("voice-note.new-tag")}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={<CheckIcon />}
            onClick={() => void save()}
            loading={saving}
            className="h-10! min-w-24 px-5! font-semibold"
          >
            {t("editor.save")}
          </Button>
        </div>
      </div>
    );
  }

  const recording = step === "recording";
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <span className={cn("font-mono tabular-nums mu-heading", recording ? "text-mu-danger" : "text-mu-text-secondary")}>
        {clock(seconds)}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-label={step === "idle" ? t("voice-note.start") : recording ? t("voice-note.pause") : t("voice-note.resume")}
        className={cn(
          "flex size-24 items-center justify-center rounded-full border border-transparent shadow-lg transition-transform active:scale-95 mu-focus",
          recording ? "animate-pulse bg-mu-danger text-white" : "bg-mu-primary text-mu-on-primary",
        )}
      >
        {recording ? <PauseIcon className="size-10" /> : <MicIcon className="size-10" />}
      </button>
      <span className="mu-caption text-mu-text-secondary">
        {step === "idle" ? t("voice-note.tap-to-start") : recording ? t("voice-note.tap-to-pause") : t("voice-note.paused")}
      </span>
      <div className="flex w-full justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          icon={<SquareIcon />}
          disabled={step === "idle"}
          onClick={() => void finish()}
          className="h-10! min-w-24 px-5! font-semibold"
        >
          {t("voice-note.done")}
        </Button>
      </div>
    </div>
  );
};

export const VoiceNoteDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useTranslate();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Popup className="w-md max-w-[calc(100vw-1rem)]">
        <Dialog.Title className="flex items-center gap-2">
          <MicIcon className="mu-icon" />
          {t("voice-note.title")}
        </Dialog.Title>
        {open && <VoiceNoteBody onClose={onClose} />}
      </Dialog.Popup>
    </Dialog.Root>
  );
};

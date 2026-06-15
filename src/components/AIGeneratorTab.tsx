import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X, Sparkles, Lock, Link } from "lucide-react";
import {
  useGenerateThemePrompt,
  useGenerateThemeFromUrl,
  useThemeGenerationModelOptions,
} from "@/hooks/useCustomThemes";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { AiAccessBanner } from "./ProBanner";
import { shouldHideDyadProUi } from "@/lib/dyad_pro_ui";
import { isLocalWebRuntime } from "@/lib/runtime_client";
import type {
  ThemeGenerationMode,
  ThemeGenerationModel,
  ThemeInputSource,
} from "@/ipc/types";
import { useTranslation } from "react-i18next";

// Image upload constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image (raw file size)
const MAX_IMAGES = 5;

// Image stored with file path (for IPC) and blob URL (for preview)
interface ThemeImage {
  path: string; // File path in temp directory
  preview: string; // Blob URL for displaying thumbnail
}

interface AIGeneratorTabProps {
  aiName: string;
  setAiName: (name: string) => void;
  aiDescription: string;
  setAiDescription: (desc: string) => void;
  aiGeneratedPrompt: string;
  setAiGeneratedPrompt: (prompt: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDialogOpen: boolean;
}

export function AIGeneratorTab({
  aiName,
  setAiName,
  aiDescription,
  setAiDescription,
  aiGeneratedPrompt,
  setAiGeneratedPrompt,
  onSave,
  isSaving,
  isDialogOpen,
}: AIGeneratorTabProps) {
  const { t } = useTranslation(["home", "common"]);
  const [aiImages, setAiImages] = useState<ThemeImage[]>([]);
  const [aiKeywords, setAiKeywords] = useState("");
  const [aiGenerationMode, setAiGenerationMode] =
    useState<ThemeGenerationMode>("inspired");
  const [aiSelectedModel, setAiSelectedModel] =
    useState<ThemeGenerationModel>("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track if dialog is open to prevent orphaned uploads from adding images after close
  const isDialogOpenRef = useRef(isDialogOpen);

  // URL-based generation state
  const [inputSource, setInputSource] = useState<ThemeInputSource>("images");
  const [websiteUrl, setWebsiteUrl] = useState("");

  const generatePromptMutation = useGenerateThemePrompt();
  const generateFromUrlMutation = useGenerateThemeFromUrl();
  const isGenerating =
    generatePromptMutation.isPending || generateFromUrlMutation.isPending;
  const { userBudget } = useUserBudgetInfo();
  const hideDyadProUi = shouldHideDyadProUi();
  const isLocalWeb = isLocalWebRuntime();
  const canUseImageGeneration = Boolean(userBudget) || isLocalWeb;
  const { themeGenerationModelOptions, isLoadingThemeGenerationModelOptions } =
    useThemeGenerationModelOptions();

  // Cleanup function to revoke blob URLs and delete temp files
  const cleanupImages = useCallback(
    async (images: ThemeImage[], showErrors = false) => {
      // Revoke blob URLs to free memory
      images.forEach((img) => {
        URL.revokeObjectURL(img.preview);
      });

      // Delete temp files via IPC
      const paths = images.map((img) => img.path);
      if (paths.length > 0) {
        try {
          await ipc.template.cleanupThemeImages({ paths });
        } catch {
          if (showErrors) {
            showError(t("home:customTheme.cleanupImagesFailed"));
          }
        }
      }
    },
    [t],
  );

  // Keep ref in sync with isDialogOpen prop
  useEffect(() => {
    isDialogOpenRef.current = isDialogOpen;
  }, [isDialogOpen]);

  useEffect(() => {
    const firstModelId = themeGenerationModelOptions[0]?.id ?? "";
    if (!firstModelId) {
      return;
    }

    if (
      !aiSelectedModel ||
      !themeGenerationModelOptions.some((model) => model.id === aiSelectedModel)
    ) {
      setAiSelectedModel(firstModelId);
    }
  }, [aiSelectedModel, themeGenerationModelOptions]);

  // Keep a ref to current images for cleanup without causing effect re-runs
  const aiImagesRef = useRef<ThemeImage[]>([]);
  useEffect(() => {
    aiImagesRef.current = aiImages;
  }, [aiImages]);

  // Cleanup images and reset state when dialog closes
  useEffect(() => {
    if (!isDialogOpen) {
      // Use ref to get current images to avoid dependency on aiImages
      const imagesToCleanup = aiImagesRef.current;
      if (imagesToCleanup.length > 0) {
        cleanupImages(imagesToCleanup);
        setAiImages([]);
      }
      setAiKeywords("");
      setAiGenerationMode("inspired");
      setAiSelectedModel(themeGenerationModelOptions[0]?.id ?? "");
      setInputSource("images");
      setWebsiteUrl("");
    }
  }, [isDialogOpen, cleanupImages, themeGenerationModelOptions]);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const availableSlots = MAX_IMAGES - aiImages.length;
      if (availableSlots <= 0) {
        showError(t("home:customTheme.maxImagesAllowed", { max: MAX_IMAGES }));
        return;
      }

      const filesToProcess = Array.from(files).slice(0, availableSlots);
      const skippedCount = files.length - filesToProcess.length;

      if (skippedCount > 0) {
        showError(
          t("home:customTheme.imageUploadSlotsSkipped", {
            availableSlots,
            skippedCount,
          }),
        );
      }

      setIsUploading(true);

      try {
        const newImages: ThemeImage[] = [];

        for (const file of filesToProcess) {
          // Validate file type
          if (!file.type.startsWith("image/")) {
            showError(
              t("home:customTheme.uploadOnlyImages", { name: file.name }),
            );
            continue;
          }

          // Validate file size (raw file size)
          if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            showError(
              t("home:customTheme.fileTooLarge", {
                name: file.name,
                size: sizeMB,
              }),
            );
            continue;
          }

          try {
            // Read file as base64 for upload
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () =>
                reject(new Error(t("home:customTheme.fileReadFailed")));
              reader.onload = () => {
                const base64 = reader.result as string;
                const data = base64.split(",")[1];
                if (!data) {
                  reject(
                    new Error(t("home:customTheme.imageDataExtractFailed")),
                  );
                  return;
                }
                resolve(data);
              };
              reader.readAsDataURL(file);
            });

            // Save to temp file via IPC
            const result = await ipc.template.saveThemeImage({
              data: base64Data,
              filename: file.name,
            });

            // Create blob URL for preview (much more memory efficient than base64 in DOM)
            const preview = URL.createObjectURL(file);

            newImages.push({
              path: result.path,
              preview,
            });
          } catch (err) {
            showError(
              t("home:customTheme.processingImageFailed", {
                name: file.name,
                error:
                  err instanceof Error
                    ? err.message
                    : t("home:customTheme.unknownError"),
              }),
            );
          }
        }

        if (newImages.length > 0) {
          // Check if dialog was closed while upload was in progress
          if (!isDialogOpenRef.current) {
            // Dialog closed - cleanup orphaned images immediately
            await cleanupImages(newImages);
            return;
          }

          setAiImages((prev) => {
            // Double-check limit in case of race conditions
            const remaining = MAX_IMAGES - prev.length;
            return [...prev, ...newImages.slice(0, remaining)];
          });
        }
      } finally {
        setIsUploading(false);
        // Reset input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [aiImages.length, cleanupImages, t],
  );

  const handleRemoveImage = useCallback(
    async (index: number) => {
      const imageToRemove = aiImages[index];
      if (imageToRemove) {
        // Cleanup the removed image - show errors since this is a user action
        await cleanupImages([imageToRemove], true);
      }
      setAiImages((prev) => prev.filter((_, i) => i !== index));
    },
    [aiImages, cleanupImages],
  );

  const handleGenerate = useCallback(async () => {
    if (isLocalWeb && inputSource === "url") {
      showError(t("home:customTheme.websiteUrlUnavailableWeb"));
      return;
    }

    if (inputSource === "images") {
      // Image-based generation
      if (aiImages.length === 0) {
        showError(t("home:customTheme.uploadAtLeastOneImage"));
        return;
      }

      try {
        const result = await generatePromptMutation.mutateAsync({
          imagePaths: aiImages.map((img) => img.path),
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        });
        setAiGeneratedPrompt(result.prompt);
        toast.success(t("home:customTheme.themePromptGenerated"));
      } catch (error) {
        showError(
          t("home:customTheme.failedGenerateTheme", {
            error:
              error instanceof Error
                ? error.message
                : t("home:customTheme.unknownError"),
          }),
        );
      }
    } else {
      // URL-based generation
      if (!websiteUrl.trim()) {
        showError(t("home:customTheme.enterWebsiteUrl"));
        return;
      }

      try {
        const result = await generateFromUrlMutation.mutateAsync({
          url: websiteUrl,
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        });

        setAiGeneratedPrompt(result.prompt);
        toast.success(t("home:customTheme.themePromptGeneratedFromWebsite"));
      } catch (error) {
        showError(
          t("home:customTheme.failedGenerateTheme", {
            error:
              error instanceof Error
                ? error.message
                : t("home:customTheme.unknownError"),
          }),
        );
      }
    }
  }, [
    inputSource,
    isLocalWeb,
    aiImages,
    websiteUrl,
    aiKeywords,
    aiGenerationMode,
    aiSelectedModel,
    generatePromptMutation,
    generateFromUrlMutation,
    setAiGeneratedPrompt,
    t,
  ]);

  // Show Pro-only locked state for Electron non-Pro users.
  if (!canUseImageGeneration) {
    return (
      <div className="space-y-4 mt-4">
        <div className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-muted-foreground/25 rounded-lg bg-muted/10">
          <Lock className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-center mb-2">
            {t("home:customTheme.aiGeneratorTitle")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {hideDyadProUi
              ? t("home:customTheme.aiUnavailableWeb")
              : t("home:customTheme.aiGeneratorDescription")}
          </p>
          {!hideDyadProUi && (
            <p className="text-xs text-muted-foreground/70 mt-2">
              {t("home:customTheme.proOnlyFeature")}
            </p>
          )}
        </div>
        {!hideDyadProUi && <AiAccessBanner />}
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="ai-name">{t("home:customTheme.themeName")}</Label>
        <Input
          id="ai-name"
          placeholder={t("home:customTheme.aiThemeNamePlaceholder")}
          value={aiName}
          onChange={(e) => setAiName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-description">
          {t("home:customTheme.descriptionOptional")}
        </Label>
        <Input
          id="ai-description"
          placeholder={t("home:customTheme.descriptionPlaceholder")}
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
        />
      </div>

      {/* Input Source Toggle */}
      <div className="space-y-3">
        <Label>{t("home:customTheme.referenceSource")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setInputSource("images")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "images"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <Upload className="h-5 w-5 mb-1" />
            <span className="font-medium text-sm">
              {t("home:customTheme.uploadImages")}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              {t("home:customTheme.uploadImagesDescription")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isLocalWeb) {
                setInputSource("url");
              }
            }}
            disabled={isLocalWeb}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "url"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            } ${isLocalWeb ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Link className="h-5 w-5 mb-1" />
            <span className="font-medium text-sm">
              {t("home:customTheme.websiteUrl")}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              {isLocalWeb
                ? t("home:customTheme.websiteUrlUnavailableWeb")
                : t("home:customTheme.websiteUrlDescription")}
            </span>
          </button>
        </div>
      </div>

      {/* Image Upload Section - only shown when inputSource is "images" */}
      {inputSource === "images" && (
        <div className="space-y-2">
          <Label>{t("home:customTheme.referenceImages")}</Label>
          <div
            className={`border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageUpload}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
            ) : (
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            )}
            <p className="text-sm text-muted-foreground">
              {isUploading
                ? t("common:uploading")
                : t("home:customTheme.clickUploadImages")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("home:customTheme.uploadUiScreenshots")}
            </p>
          </div>

          {/* Image counter */}
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t("home:customTheme.imageCount", {
              count: aiImages.length,
              max: MAX_IMAGES,
            })}
            {aiImages.length >= MAX_IMAGES && (
              <span className="text-destructive ml-2">
                {t("home:customTheme.maximumReached")}
              </span>
            )}
          </p>

          {/* Image Preview */}
          {aiImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {aiImages.map((img, index) => (
                <div key={img.path} className="relative group">
                  <img
                    src={img.preview}
                    alt={t("home:customTheme.uploadAlt", {
                      index: index + 1,
                    })}
                    className="h-16 w-16 object-cover rounded-md border"
                  />
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t("home:customTheme.removeImage")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* URL Input Section - only shown when inputSource is "url" */}
      {inputSource === "url" && (
        <div className="space-y-2">
          <Label htmlFor="website-url">
            {t("home:customTheme.websiteUrl")}
          </Label>
          <Input
            id="website-url"
            type="url"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={isGenerating}
          />
          <p className="text-xs text-muted-foreground">
            {t("home:customTheme.websiteUrlHelp")}
          </p>
        </div>
      )}

      {/* Keywords Input */}
      <div className="space-y-2">
        <Label htmlFor="ai-keywords">
          {t("home:customTheme.keywordsOptional")}
        </Label>
        <Input
          id="ai-keywords"
          placeholder={t("home:customTheme.keywordsPlaceholder")}
          value={aiKeywords}
          onChange={(e) => setAiKeywords(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("home:customTheme.keywordsHelp")}
        </p>
      </div>

      {/* Generation Mode Selection */}
      <div className="space-y-3">
        <Label>{t("home:customTheme.generationMode")}</Label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setAiGenerationMode("inspired")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "inspired"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">
              {t("home:customTheme.inspired")}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              {t("home:customTheme.inspiredDescription")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAiGenerationMode("high-fidelity")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "high-fidelity"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">
              {t("home:customTheme.highFidelity")}
            </span>
            <span className="text-xs text-muted-foreground mt-1">
              {t("home:customTheme.highFidelityDescription")}
            </span>
          </button>
        </div>
      </div>

      {/* Model Selection */}
      <div className="space-y-3">
        <Label>{t("home:customTheme.modelSelection")}</Label>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3"
          role="radiogroup"
          aria-label={t("home:customTheme.modelSelection")}
        >
          {isLoadingThemeGenerationModelOptions ? (
            <div className="col-span-full flex items-center justify-center py-3 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("home:customTheme.loadingModels")}
            </div>
          ) : themeGenerationModelOptions.length === 0 ? (
            <div className="col-span-full text-center py-3 text-sm text-muted-foreground">
              {t("home:customTheme.noModelsAvailable")}
            </div>
          ) : (
            themeGenerationModelOptions.map((modelOption) => (
              <button
                key={modelOption.id}
                type="button"
                role="radio"
                aria-checked={aiSelectedModel === modelOption.id}
                onClick={() => setAiSelectedModel(modelOption.id)}
                className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
                  aiSelectedModel === modelOption.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="font-medium text-sm">{modelOption.label}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Generate Button */}
      <Button
        onClick={handleGenerate}
        disabled={
          isLoadingThemeGenerationModelOptions ||
          !aiSelectedModel ||
          isGenerating ||
          (isLocalWeb && inputSource === "url") ||
          (inputSource === "images" && aiImages.length === 0) ||
          (inputSource === "url" && !websiteUrl.trim())
        }
        variant="secondary"
        className="w-full"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {inputSource === "url"
              ? t("home:customTheme.generatingFromWebsite")
              : t("home:customTheme.generatingPrompt")}
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("home:customTheme.generateThemePrompt")}
          </>
        )}
      </Button>

      {/* Generated Prompt Display */}
      <div className="space-y-2">
        <Label htmlFor="ai-prompt">
          {t("home:customTheme.generatedPrompt")}
        </Label>
        {aiGeneratedPrompt ? (
          <Textarea
            id="ai-prompt"
            className="min-h-[200px] font-mono text-sm"
            value={aiGeneratedPrompt}
            onChange={(e) => setAiGeneratedPrompt(e.target.value)}
            placeholder={t("home:customTheme.generatedPromptPlaceholder")}
          />
        ) : (
          <div className="min-h-[100px] border rounded-md p-4 flex items-center justify-center text-muted-foreground text-sm text-center">
            {t("home:customTheme.noPromptGeneratedYet")}{" "}
            {inputSource === "images"
              ? t("home:customTheme.noPromptGeneratedImages")
              : t("home:customTheme.noPromptGeneratedUrl")}
          </div>
        )}
      </div>

      {/* Save Button - only show when prompt is generated */}
      {aiGeneratedPrompt && (
        <Button
          onClick={onSave}
          disabled={isSaving || !aiName.trim()}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common:saving")}
            </>
          ) : (
            t("home:customTheme.saveTheme")
          )}
        </Button>
      )}
    </div>
  );
}

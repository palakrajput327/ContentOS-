import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Scissors,
  Check,
  X,
  Loader2,
  Layers,
  LayoutGrid,
  Maximize2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { clipdropApi } from "../lib/api";

export interface ClipdropImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach?: (result: { assetId: string; url: string; filename: string }) => void;
  initialContentText?: string;
  initialTitle?: string;
  contentId?: string;
  targetPlatform?: string;
}

export const ClipdropImageModal: React.FC<ClipdropImageModalProps> = ({
  isOpen,
  onClose,
  onAttach,
  initialContentText = "",
  initialTitle = "",
  contentId,
  targetPlatform = "LinkedIn",
}) => {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "4:5" | "9:16" | "16:9">("1:1");
  const [headline, setHeadline] = useState(initialTitle || "");
  const [logoText, setLogoText] = useState("Hindustan Software Solution");
  const [websiteUrl, setWebsiteUrl] = useState("hindustansoftwaresolution.com");
  const [cta, setCta] = useState("Learn More");
  const [enableBrandOverlay, setEnableBrandOverlay] = useState(true);

  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  const [generatedAsset, setGeneratedAsset] = useState<{
    assetId: string;
    url: string;
    filename: string;
    remainingCredits: number | null;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTitle) setHeadline(initialTitle);
      if (targetPlatform === "YouTube") setAspectRatio("16:9");
      else if (targetPlatform === "LinkedIn") setAspectRatio("1:1");
      else if (targetPlatform === "Telegram") setAspectRatio("4:5");

      if (initialContentText && !prompt) {
        handleSuggestPrompt();
      }
    }
  }, [isOpen, initialContentText, initialTitle, targetPlatform]);

  if (!isOpen) return null;

  async function handleSuggestPrompt() {
    try {
      setIsSuggesting(true);
      const res = await clipdropApi.suggestPrompt(
        initialContentText || headline || "AI content studio distribution platform",
        targetPlatform,
      );
      setPrompt(res.prompt);
    } catch (err: any) {
      console.error("Suggest prompt error:", err);
      toast.error("Could not suggest prompt automatically. You can type one below!");
    } finally {
      setIsSuggesting(false);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error("Please enter an image prompt.");
      return;
    }

    try {
      setIsGenerating(true);
      const res = await clipdropApi.generateImage({
        prompt: prompt.trim(),
        aspectRatio,
        headline: enableBrandOverlay && headline.trim() ? headline.trim() : undefined,
        logoText: enableBrandOverlay && logoText.trim() ? logoText.trim() : undefined,
        websiteUrl: enableBrandOverlay && websiteUrl.trim() ? websiteUrl.trim() : undefined,
        cta: enableBrandOverlay && cta.trim() ? cta.trim() : undefined,
        contentId,
        platform: targetPlatform,
      });

      setGeneratedAsset({
        assetId: res.assetId,
        url: res.url,
        filename: res.filename,
        remainingCredits: res.remainingCredits,
      });

      toast.success(
        res.cached
          ? "Reused cached image (No credits spent!)"
          : res.status === "NEEDS_REVIEW"
          ? "Generated visual & attached to draft post (Status: Needs Review)!"
          : "Image generated with Clipdrop successfully!"
      );

      if (onAttach) {
        onAttach({
          assetId: res.assetId,
          url: res.url,
          filename: res.filename,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate image with Clipdrop.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRemoveBackground() {
    if (!generatedAsset?.assetId) return;

    try {
      setIsRemovingBg(true);
      const res = await clipdropApi.removeBackground(generatedAsset.assetId);
      setGeneratedAsset((prev) =>
        prev
          ? {
              ...prev,
              assetId: res.assetId,
              url: res.url,
              filename: res.filename,
              remainingCredits: res.remainingCredits ?? prev.remainingCredits,
            }
          : null
      );
      toast.success("Background removed cleanly with Clipdrop!");

      if (onAttach) {
        onAttach({
          assetId: res.assetId,
          url: res.url,
          filename: res.filename,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to remove background.");
    } finally {
      setIsRemovingBg(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.8)",
        backdropFilter: "blur(8px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          maxHeight: "90vh",
          backgroundColor: "#0f172a",
          border: "1px solid rgba(99, 102, 241, 0.3)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(99, 102, 241, 0.1), transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Wand2 size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#f8fafc" }}>
                Clipdrop AI Image Generator & Brand Canvas
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                Generate high-impact visuals for {targetPlatform} posts with brand overlay & background removal.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "8px",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", flex: 1, overflowY: "auto" }}>
          {/* Controls Column */}
          <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Visual Prompt Input */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#cbd5e1" }}>
                  Visual Prompt (Clipdrop Text-to-Image)
                </label>
                <button
                  type="button"
                  onClick={handleSuggestPrompt}
                  disabled={isSuggesting}
                  style={{
                    background: "rgba(99, 102, 241, 0.15)",
                    color: "#818cf8",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {isSuggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Suggest Prompt from Post
                </button>
              </div>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Modern futuristic 3D graphic representing AI content distribution, high contrast, studio lighting"
                style={{
                  width: "100%",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "10px",
                  color: "#f8fafc",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>

            {/* Aspect Ratio Presets */}
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "8px", display: "block" }}>
                Aspect Ratio Preset
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {[
                  { ratio: "1:1", label: "1:1 Square", sub: "LinkedIn / Feed" },
                  { ratio: "4:5", label: "4:5 Portrait", sub: "LinkedIn Post" },
                  { ratio: "16:9", label: "16:9 Landscape", sub: "YouTube Thumb" },
                  { ratio: "9:16", label: "9:16 Story", sub: "Reels / Shorts" },
                ].map((item) => (
                  <button
                    key={item.ratio}
                    type="button"
                    onClick={() => setAspectRatio(item.ratio as any)}
                    style={{
                      padding: "10px",
                      borderRadius: "8px",
                      border: aspectRatio === item.ratio ? "2px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.08)",
                      background: aspectRatio === item.ratio ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.03)",
                      color: aspectRatio === item.ratio ? "#818cf8" : "#94a3b8",
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "0.85rem" }}>{item.label}</div>
                    <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>{item.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ContentOS Brand Overlay Settings */}
            <div style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: "12px", padding: "16px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f8fafc", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Layers size={15} style={{ color: "#34d399" }} /> ContentOS Brand Canvas Overlay
                </label>
                <input
                  type="checkbox"
                  checked={enableBrandOverlay}
                  onChange={(e) => setEnableBrandOverlay(e.target.checked)}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
              </div>

              {enableBrandOverlay && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Headline Text</label>
                    <input
                      type="text"
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      placeholder="e.g. 74% Reduction in Adaptation Overhead"
                      style={{
                        width: "100%",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px",
                        padding: "8px",
                        color: "#fff",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Brand Badge / Logo</label>
                      <input
                        type="text"
                        value={logoText}
                        onChange={(e) => setLogoText(e.target.value)}
                        placeholder="e.g. Hindustan Software Solution"
                        style={{
                          width: "100%",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "6px",
                          padding: "8px",
                          color: "#fff",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Website Domain</label>
                      <input
                        type="text"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="e.g. hindustansoftwaresolution.com"
                        style={{
                          width: "100%",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "6px",
                          padding: "8px",
                          color: "#fff",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", color: "#94a3b8" }}>CTA Button Text</label>
                      <input
                        type="text"
                        value={cta}
                        onChange={(e) => setCta(e.target.value)}
                        placeholder="e.g. Learn More"
                        style={{
                          width: "100%",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "6px",
                          padding: "8px",
                          color: "#fff",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ marginTop: "auto", display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  cursor: isGenerating ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                {isGenerating ? "Generating with Clipdrop..." : "Generate Visual (Clipdrop)"}
              </button>
            </div>
          </div>

          {/* Preview Column */}
          <div
            style={{
              padding: "24px",
              background: "rgba(0, 0, 0, 0.2)",
              borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {generatedAsset ? (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
                <div
                  style={{
                    width: "100%",
                    borderRadius: "12px",
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    background: "#000",
                    position: "relative",
                  }}
                >
                  <img
                    src={generatedAsset.url}
                    alt="Generated Visual"
                    style={{ width: "100%", display: "block", objectFit: "contain" }}
                  />
                  {generatedAsset.remainingCredits !== null && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: "12px",
                        right: "12px",
                        background: "rgba(15, 23, 42, 0.92)",
                        border: "1px solid rgba(52, 211, 153, 0.4)",
                        color: "#34d399",
                        fontSize: "0.75rem",
                        padding: "4px 10px",
                        borderRadius: "12px",
                        fontWeight: 700,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      Clipdrop Credits: {generatedAsset.remainingCredits}
                    </span>
                  )}
                </div>

                {/* Additional Clipdrop Tools */}
                <div style={{ width: "100%", display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={handleRemoveBackground}
                    disabled={isRemovingBg}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#cbd5e1",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                    }}
                  >
                    {isRemovingBg ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                    Remove Background
                  </button>
                </div>

                <div
                  style={{
                    background: "rgba(16, 185, 129, 0.1)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: "8px",
                    padding: "10px",
                    width: "100%",
                    textAlign: "center",
                    fontSize: "0.8rem",
                    color: "#34d399",
                  }}
                >
                  ✓ Media saved as asset & attached to draft post. Draft status updated to <strong>NEEDS_REVIEW</strong>.
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: "#64748b" }}>
                <ImageIcon size={48} style={{ opacity: 0.4, marginBottom: "12px" }} />
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  Generated Clipdrop visual and brand canvas will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

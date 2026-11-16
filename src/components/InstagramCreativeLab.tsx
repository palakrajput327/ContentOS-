import React, { useState } from "react";
import {
  Sparkles,
  RotateCw,
  Crown,
  Zap,
  Flame,
  Check,
  Copy,
  Layers,
  Save,
  Palette,
  AlertCircle,
  Pencil,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "./ui";
import {
  instagramStudioApi,
  type BrandDnaProfile,
  type CreativeVariationItem,
} from "../lib/api";

interface InstagramCreativeLabProps {
  brandDna: BrandDnaProfile | null;
  onOpenBrandModal: () => void;
  onBuildCarousel: (conceptTopic: string, variation?: CreativeVariationItem) => void;
}

export const InstagramCreativeLab: React.FC<InstagramCreativeLabProps> = ({
  brandDna,
  onOpenBrandModal,
  onBuildCarousel,
}) => {
  const [topic, setTopic] = useState("");
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const [variations, setVariations] = useState<CreativeVariationItem[]>([]);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [savedDraftIds, setSavedDraftIds] = useState<Record<string, boolean>>({});
  const [editingVariationId, setEditingVariationId] = useState<string | null>(null);
  const [editedCaptions, setEditedCaptions] = useState<Record<string, string>>({});
  const [editedHeadlines, setEditedHeadlines] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sampleIdeas = [
    "5 High-Yield Wealth Strategies for 2026",
    "Why Elite Founders Automate Before They Scale",
    "Institutional Liquidity Architecture Explained",
    "From Zero to 10k MRR: The Blueprint",
  ];

  const handleGenerateVariations = async () => {
    if (!topic.trim()) {
      setError("Please enter a topic or select one of the suggested ideas.");
      return;
    }
    setError(null);
    setGeneratingBatch(true);
    try {
      const res = await instagramStudioApi.generateVariations(topic.trim());
      setVariations(res.variations || []);
      setSavedDraftIds({});
    } catch (err: any) {
      console.error("[CreativeLab] Error generating variations:", err);
      setError(err?.message || "Failed to generate creative variations.");
    } finally {
      setGeneratingBatch(false);
    }
  };

  const handleGenerateImage = async (variation: CreativeVariationItem) => {
    if (generatingImageId) return;
    setGeneratingImageId(variation.id);
    setError(null);
    try {
      const res = await instagramStudioApi.generateVariationImage(variation.id, variation.prompt);
      setVariations((prev) =>
        prev.map((v) =>
          v.id === variation.id
            ? { ...v, ...res.variation, imageUrl: res.imageUrl, assetId: res.assetId }
            : v
        )
      );
    } catch (err: any) {
      console.error("[CreativeLab] Error generating image:", err);
      setError(err?.message || "Failed to generate Instagram visual.");
    } finally {
      setGeneratingImageId(null);
    }
  };

  const handleRegenerateVariation = async (variation: CreativeVariationItem) => {
    if (regeneratingId) return;
    setRegeneratingId(variation.id);
    setError(null);
    try {
      const res = await instagramStudioApi.regenerateVariation(variation.id, topic || variation.headline);
      setVariations((prev) =>
        prev.map((v) => (v.id === variation.id ? res : v))
      );
    } catch (err: any) {
      console.error("[CreativeLab] Error regenerating variation:", err);
      setError(err?.message || "Failed to regenerate this concept.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleSaveDraft = async (variation: CreativeVariationItem) => {
    if (savingDraftId) return;
    setSavingDraftId(variation.id);
    setError(null);
    try {
      await instagramStudioApi.saveVariationAsDraft(variation.id);
      setSavedDraftIds((prev) => ({ ...prev, [variation.id]: true }));
    } catch (err: any) {
      console.error("[CreativeLab] Error saving draft:", err);
      setError(err?.message || "Failed to save Instagram draft.");
    } finally {
      setSavingDraftId(null);
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStyleMeta = (style: string) => {
    const s = style?.toUpperCase() || "";
    if (s.includes("LUXURY") || s.includes("PREMIUM")) {
      return {
        icon: <Crown size={16} className="text-amber-400" />,
        badgeText: "Premium / Luxury",
        badgeStyle: "bg-amber-950/40 text-amber-300 border-amber-600/40",
        cardBorder: "border-amber-500/30 hover:border-amber-500/60",
        headerBg: "from-amber-950/20 to-black/40",
      };
    }
    if (s.includes("MINIMAL") || s.includes("MODERN")) {
      return {
        icon: <Zap size={16} className="text-sky-400" />,
        badgeText: "Modern / Minimal",
        badgeStyle: "bg-sky-950/40 text-sky-300 border-sky-600/40",
        cardBorder: "border-sky-500/30 hover:border-sky-500/60",
        headerBg: "from-sky-950/20 to-black/40",
      };
    }
    return {
      icon: <Flame size={16} className="text-orange-400" />,
      badgeText: "Bold / High Engagement",
      badgeStyle: "bg-orange-950/40 text-orange-300 border-orange-600/40",
      cardBorder: "border-orange-500/30 hover:border-orange-500/60",
      headerBg: "from-orange-950/20 to-black/40",
    };
  };

  const primaryBrandColor = brandDna?.brandColors?.[0] || "#f97316";

  return (
    <div className="space-y-6">
      {/* Brand DNA Quick Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-orange-500/10 border border-orange-500/20 text-orange-400 font-bold overflow-hidden">
            {brandDna?.logoUrl ? (
              <img
                src={brandDna.logoUrl}
                alt="Brand Logo"
                className="w-8 h-8 object-contain rounded"
              />
            ) : (
              <Palette size={20} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--ink)]">
                Brand DNA:{" "}
                <span className="text-orange-400">
                  {brandDna?.companyName || "Default Brand"}
                </span>
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  brandDna?.status === "APPROVED" || brandDna?.status === "ACTIVE"
                    ? "bg-emerald-950/50 text-emerald-400 border border-emerald-600/40"
                    : "bg-amber-950/50 text-amber-400 border border-amber-600/40"
                }`}
              >
                {brandDna?.status || "PENDING_REVIEW"}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)] m-0">
              {brandDna?.industry || "Commercial Brand"} • {brandDna?.communicationTone || "Professional"}
              {primaryBrandColor && (
                <span className="inline-flex items-center gap-1 ml-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-white/20"
                    style={{ backgroundColor: primaryBrandColor }}
                  />
                  <span>{primaryBrandColor}</span>
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenBrandModal}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] hover:bg-[var(--surface)] text-[var(--ink)] transition flex items-center gap-1.5"
        >
          <Palette size={13} className="text-orange-400" />
          <span>Edit Brand Identity</span>
        </button>
      </div>

      {/* Lab Generator Input Area */}
      <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
            Instagram Topic / Content Concept
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. 5 Wealth Building Habits of Ultra-High Net Worth Individuals"
              className="flex-1 bg-[var(--surface2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-orange-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !generatingBatch) {
                  handleGenerateVariations();
                }
              }}
            />
            <Button
              variant="primary"
              onClick={handleGenerateVariations}
              disabled={generatingBatch || !topic.trim()}
              className="px-5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-semibold flex items-center gap-2 shadow-lg shadow-orange-500/20"
            >
              {generatingBatch ? (
                <>
                  <RotateCw size={14} className="animate-spin" />
                  <span>Synthesizing 3 Concepts...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Generate 3 Variations</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Suggested Quick Topic Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">
            Quick Prompts:
          </span>
          {sampleIdeas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setTopic(idea)}
              className="text-xs px-2.5 py-1 rounded-lg bg-[var(--surface2)] border border-[var(--border)] hover:border-orange-500/40 text-[var(--muted)] hover:text-[var(--ink)] transition"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 3 Variations Side-by-Side Comparison Grid */}
      {variations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
              <Sparkles size={16} className="text-orange-400" />
              <span>Side-by-Side Creative Concepts (Compare & Choose)</span>
            </h3>
            <span className="text-xs text-[var(--muted)]">
              Aspect Ratio: 4:5 Portrait (Instagram Optimized)
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {variations.map((v) => {
              const meta = getStyleMeta(v.conceptStyle);
              const isImageGenerating = generatingImageId === v.id;
              const isRegenerating = regeneratingId === v.id;
              const isSaving = savingDraftId === v.id;
              const isDraftSaved = savedDraftIds[v.id];
              const isEditing = editingVariationId === v.id;
              const currentHeadline = editedHeadlines[v.id] ?? v.headline;
              const currentCaption = editedCaptions[v.id] ?? v.caption;

              return (
                <div
                  key={v.id}
                  className={`flex flex-col justify-between rounded-2xl bg-[var(--surface)] border transition-all shadow-md overflow-hidden ${meta.cardBorder}`}
                >
                  {/* Card Header with Style Badge */}
                  <div className={`p-4 border-b border-[var(--border)] bg-gradient-to-b ${meta.headerBg}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${meta.badgeStyle}`}
                      >
                        {meta.icon}
                        <span>{meta.badgeText}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => handleRegenerateVariation(v)}
                        disabled={isRegenerating}
                        title="Regenerate this variation independently"
                        className="text-xs text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1 transition"
                      >
                        <RotateCw
                          size={12}
                          className={isRegenerating ? "animate-spin" : ""}
                        />
                        <span>{isRegenerating ? "Regenerating..." : "Regenerate"}</span>
                      </button>
                    </div>

                    {isEditing ? (
                      <input
                        type="text"
                        value={currentHeadline}
                        onChange={(e) =>
                          setEditedHeadlines((prev) => ({
                            ...prev,
                            [v.id]: e.target.value,
                          }))
                        }
                        className="w-full text-sm font-bold bg-[var(--surface2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--ink)]"
                      />
                    ) : (
                      <h4 className="text-sm font-bold text-[var(--ink)] line-clamp-2">
                        {currentHeadline}
                      </h4>
                    )}
                  </div>

                  {/* 4:5 Instagram Visual Frame */}
                  <div className="p-4 flex-1 space-y-3">
                    <div
                      className="relative w-full rounded-xl overflow-hidden bg-black/40 border border-[var(--border)] flex items-center justify-center"
                      style={{ aspectRatio: "4 / 5" }}
                    >
                      {v.imageUrl ? (
                        <>
                          <img
                            src={v.imageUrl}
                            alt={currentHeadline}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-semibold text-white/90">
                            FLUX 4:5 Branded
                          </div>
                        </>
                      ) : (
                        <div className="text-center p-6 space-y-3">
                          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-orange-500/10 border border-orange-500/20 text-orange-400">
                            <ImageIcon size={22} />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[var(--ink)]">
                              Visual not yet synthesized
                            </div>
                            <p className="text-[11px] text-[var(--muted)] m-0">
                              FLUX.1 with Canvas Brand DNA overlay
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => handleGenerateImage(v)}
                            disabled={isImageGenerating}
                            className="text-xs px-3 py-1.5 mx-auto bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border-orange-500/30 flex items-center gap-1.5"
                          >
                            {isImageGenerating ? (
                              <>
                                <RotateCw size={12} className="animate-spin" />
                                <span>Synthesizing...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={12} />
                                <span>Synthesize 4:5 Visual</span>
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* FLUX Prompt Snippet */}
                    <div className="p-2.5 rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                        <span>FLUX Visual Direction:</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(v.id + "-p", v.prompt)}
                          className="hover:text-[var(--ink)] flex items-center gap-1"
                        >
                          {copiedId === v.id + "-p" ? (
                            <Check size={10} className="text-emerald-400" />
                          ) : (
                            <Copy size={10} />
                          )}
                          <span>{copiedId === v.id + "-p" ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                      <p className="text-[var(--muted)] line-clamp-2 italic m-0">
                        "{v.prompt}"
                      </p>
                    </div>

                    {/* Caption Preview & Inline Editor */}
                    <div className="p-2.5 rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                        <span>Instagram Caption & Hook:</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingVariationId(null);
                              } else {
                                setEditingVariationId(v.id);
                              }
                            }}
                            className="hover:text-[var(--ink)] flex items-center gap-1"
                          >
                            <Pencil size={10} />
                            <span>{isEditing ? "Done" : "Edit"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(v.id + "-c", currentCaption)}
                            className="hover:text-[var(--ink)] flex items-center gap-1"
                          >
                            {copiedId === v.id + "-c" ? (
                              <Check size={10} className="text-emerald-400" />
                            ) : (
                              <Copy size={10} />
                            )}
                            <span>{copiedId === v.id + "-c" ? "Copied" : "Copy"}</span>
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <textarea
                          rows={4}
                          value={currentCaption}
                          onChange={(e) =>
                            setEditedCaptions((prev) => ({
                              ...prev,
                              [v.id]: e.target.value,
                            }))
                          }
                          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded p-2 text-xs text-[var(--ink)] focus:outline-none focus:border-orange-500 resize-y"
                        />
                      ) : (
                        <p className="text-[var(--ink)] whitespace-pre-line line-clamp-3 m-0">
                          {currentCaption}
                        </p>
                      )}

                      {v.cta && (
                        <div className="pt-1 text-[10px] font-semibold text-orange-400">
                          CTA: {v.cta}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="p-4 border-t border-[var(--border)] bg-[var(--surface2)] space-y-2">
                    <Button
                      variant="primary"
                      onClick={() => handleSaveDraft(v)}
                      disabled={isSaving || isDraftSaved}
                      className={`w-full py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                        isDraftSaved
                          ? "bg-emerald-600 text-white cursor-default"
                          : "bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/20"
                      }`}
                    >
                      {isSaving ? (
                        <>
                          <RotateCw size={12} className="animate-spin" />
                          <span>Saving Instagram Draft...</span>
                        </>
                      ) : isDraftSaved ? (
                        <>
                          <Check size={12} />
                          <span>Saved as Instagram Draft</span>
                        </>
                      ) : (
                        <>
                          <Save size={12} />
                          <span>Save as Instagram Draft</span>
                        </>
                      )}
                    </Button>

                    <button
                      type="button"
                      onClick={() => onBuildCarousel(topic || currentHeadline, v)}
                      className="w-full py-1.5 text-xs font-semibold rounded-lg border border-[var(--border)] hover:border-orange-500/50 bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center gap-1.5 transition"
                    >
                      <Layers size={13} className="text-orange-400" />
                      <span>Build Carousel from this Concept</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

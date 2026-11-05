import React, { useState, useEffect } from "react";
import {
  Sparkles,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Layers,
  Save,
  Send,
  Pencil,
  Check,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "./ui";
import {
  instagramStudioApi,
  type BrandDnaProfile,
  type InstagramCarouselItem,
  type CarouselSlideItem,
} from "../lib/api";

interface InstagramCarouselBuilderProps {
  initialTopic?: string;
  brandDna: BrandDnaProfile | null;
  onOpenBrandModal: () => void;
}

export const InstagramCarouselBuilder: React.FC<InstagramCarouselBuilderProps> = ({
  initialTopic = "",
  brandDna,
  onOpenBrandModal,
}) => {
  const [topic, setTopic] = useState(initialTopic);
  const [slideCount, setSlideCount] = useState<number>(6);
  const [themeStyle, setThemeStyle] = useState<string>("luxury");
  const [generating, setGenerating] = useState(false);
  const [renderingSlides, setRenderingSlides] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const [carousel, setCarousel] = useState<InstagramCarouselItem | null>(null);
  const [slides, setSlides] = useState<CarouselSlideItem[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  // Editing state for active slide
  const [editingSlide, setEditingSlide] = useState<boolean>(false);
  const [editHeadline, setEditHeadline] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBadge, setEditBadge] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTopic) {
      setTopic(initialTopic);
    }
  }, [initialTopic]);

  const activeSlide = slides[activeSlideIndex] || null;

  useEffect(() => {
    if (activeSlide) {
      setEditHeadline(activeSlide.headline || "");
      setEditBody(activeSlide.bodyText || "");
      setEditBadge(activeSlide.badgeText || "");
      setEditingSlide(false);
    }
  }, [activeSlideIndex, activeSlide?.id]);

  const handleGenerateCarousel = async () => {
    if (!topic.trim()) {
      setError("Please provide a topic or outline for your Instagram carousel.");
      return;
    }
    setError(null);
    setGenerating(true);
    setDraftSaved(false);
    setPublished(false);
    try {
      const res = await instagramStudioApi.generateCarousel({
        topic: topic.trim(),
        slideCount,
        themeStyle,
      });
      setCarousel(res);
      setSlides(res.slides || []);
      setActiveSlideIndex(0);
    } catch (err: any) {
      console.error("[CarouselBuilder] Error generating carousel:", err);
      setError(err?.message || "Failed to generate carousel slides.");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveActiveSlide = async () => {
    if (!activeSlide || !carousel) return;
    try {
      const updated = await instagramStudioApi.updateSlide(carousel.id, activeSlide.id, {
        headline: editHeadline,
        bodyText: editBody,
        badgeText: editBadge,
      });
      setSlides((prev) =>
        prev.map((s) => (s.id === activeSlide.id ? updated : s))
      );
      setEditingSlide(false);
    } catch (err: any) {
      console.error("[CarouselBuilder] Error updating slide:", err);
      setError(err?.message || "Failed to save slide edits.");
    }
  };

  const handleMoveSlide = async (index: number, direction: "left" | "right") => {
    if (!carousel) return;
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    const newSlides = [...slides];
    const [moved] = newSlides.splice(index, 1);
    newSlides.splice(targetIndex, 0, moved);

    // Update order indices
    const ordered = newSlides.map((s, idx) => ({ ...s, slideIndex: idx + 1 }));
    setSlides(ordered);
    setActiveSlideIndex(targetIndex);

    try {
      await instagramStudioApi.reorderSlides(
        carousel.id,
        ordered.map((s) => s.id)
      );
    } catch (err) {
      console.warn("[CarouselBuilder] Failed to persist slide order:", err);
    }
  };

  const handleRenderAllSlides = async () => {
    if (!carousel) return;
    setRenderingSlides(true);
    setError(null);
    try {
      const res = await instagramStudioApi.renderAllSlides(carousel.id);
      setSlides(res.slides || []);
    } catch (err: any) {
      console.error("[CarouselBuilder] Error rendering slide canvas:", err);
      setError(err?.message || "Failed to render carousel canvas.");
    } finally {
      setRenderingSlides(false);
    }
  };

  const handleSaveAsDraft = async () => {
    if (!carousel) return;
    setSavingDraft(true);
    setError(null);
    try {
      await instagramStudioApi.saveCarouselAsDraft(carousel.id);
      setDraftSaved(true);
    } catch (err: any) {
      console.error("[CarouselBuilder] Error saving carousel draft:", err);
      setError(err?.message || "Failed to save carousel draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublishNow = async () => {
    if (!carousel) return;
    setPublishing(true);
    setError(null);
    try {
      await instagramStudioApi.publishCarouselNow(carousel.id);
      setPublished(true);
    } catch (err: any) {
      console.error("[CarouselBuilder] Error publishing carousel:", err);
      setError(err?.message || "Instagram publishing failed or account not connected.");
    } finally {
      setPublishing(false);
    }
  };

  const primaryColor = brandDna?.brandColors?.[0] || "#f97316";

  return (
    <div className="space-y-6">
      {/* Input / Control Panel */}
      <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
            Carousel Topic / Lesson / Guide
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. 7 Non-Obvious Rules for Scaling B2B Revenue in 2026"
            className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-orange-500"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                Slide Count (5 - 10)
              </label>
              <select
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
                className="bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--ink)] focus:outline-none focus:border-orange-500"
              >
                {[5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} Slides {n === 6 ? "(Recommended)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                Visual Aesthetic
              </label>
              <select
                value={themeStyle}
                onChange={(e) => setThemeStyle(e.target.value)}
                className="bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--ink)] focus:outline-none focus:border-orange-500"
              >
                <option value="luxury">👑 Luxury / Obsidian</option>
                <option value="minimal">⚡ Modern / Minimal</option>
                <option value="bold">🔥 Bold / High Contrast</option>
              </select>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={handleGenerateCarousel}
            disabled={generating || !topic.trim()}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-semibold flex items-center gap-2 shadow-lg shadow-orange-500/20"
          >
            {generating ? (
              <>
                <RotateCw size={14} className="animate-spin" />
                <span>Synthesizing {slideCount} Slides...</span>
              </>
            ) : (
              <>
                <Layers size={14} />
                <span>Build {slideCount}-Slide Carousel</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Carousel Studio Workstation */}
      {slides.length > 0 && (
        <div className="space-y-6">
          {/* Top Control Bar with Slide Counter & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
                {carousel?.title || "Instagram Carousel"}
              </span>
              <span className="text-xs text-[var(--muted)]">
                ({slides.length} Slides • 4:5 Portrait)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={handleRenderAllSlides}
                disabled={renderingSlides}
                className="text-xs px-3 py-1.5 flex items-center gap-1.5 border-[var(--border)]"
              >
                {renderingSlides ? (
                  <>
                    <RotateCw size={12} className="animate-spin" />
                    <span>Rendering 1080x1350 Canvas...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="text-orange-400" />
                    <span>Render High-Res Slides</span>
                  </>
                )}
              </Button>

              <Button
                variant="secondary"
                onClick={handleSaveAsDraft}
                disabled={savingDraft || draftSaved}
                className={`text-xs px-3 py-1.5 flex items-center gap-1.5 ${
                  draftSaved
                    ? "bg-emerald-950/40 text-emerald-400 border-emerald-600/40"
                    : ""
                }`}
              >
                {savingDraft ? (
                  <>
                    <RotateCw size={12} className="animate-spin" />
                    <span>Saving Draft...</span>
                  </>
                ) : draftSaved ? (
                  <>
                    <Check size={12} />
                    <span>Draft Saved</span>
                  </>
                ) : (
                  <>
                    <Save size={12} />
                    <span>Save Draft Post</span>
                  </>
                )}
              </Button>

              <Button
                variant="primary"
                onClick={handlePublishNow}
                disabled={publishing || published}
                className={`text-xs px-4 py-1.5 flex items-center gap-1.5 ${
                  published
                    ? "bg-emerald-600 text-white"
                    : "bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md shadow-orange-500/20"
                }`}
              >
                {publishing ? (
                  <>
                    <RotateCw size={12} className="animate-spin" />
                    <span>Publishing to Instagram...</span>
                  </>
                ) : published ? (
                  <>
                    <Check size={12} />
                    <span>Published to Instagram</span>
                  </>
                ) : (
                  <>
                    <Send size={12} />
                    <span>Publish Carousel</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 4:5 Active Slide Studio Stage */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: 4:5 Canvas Display */}
            <div className="lg:col-span-7 flex flex-col items-center">
              <div
                className="relative w-full max-w-[420px] rounded-2xl overflow-hidden shadow-2xl border border-[var(--border)] flex flex-col justify-between p-7 text-white"
                style={{
                  aspectRatio: "4 / 5",
                  background: activeSlide?.imageUrl
                    ? `url(${activeSlide.imageUrl}) center/cover no-repeat`
                    : themeStyle === "luxury"
                    ? "linear-gradient(145deg, #0a0d14 0%, #030408 100%)"
                    : themeStyle === "minimal"
                    ? "linear-gradient(145deg, #0f172a 0%, #020617 100%)"
                    : "linear-gradient(145deg, #180802 0%, #030303 100%)",
                }}
              >
                {/* Slide Header: Badge + Slide Indicator Pill */}
                <div className="flex items-center justify-between z-10">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full backdrop-blur-md border"
                    style={{
                      background: "rgba(255, 255, 255, 0.08)",
                      borderColor: "rgba(255, 255, 255, 0.15)",
                      color: primaryColor,
                    }}
                  >
                    {activeSlide?.badgeText || `SLIDE ${activeSlideIndex + 1}`}
                  </span>

                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white/80">
                    {activeSlideIndex + 1} / {slides.length}
                  </span>
                </div>

                {/* Slide Center: Big Headline & Body Narrative */}
                <div className="space-y-4 my-auto z-10">
                  <h2 className="text-xl md:text-2xl font-black leading-tight tracking-tight drop-shadow-md">
                    {activeSlide?.headline}
                  </h2>
                  <p className="text-sm md:text-base text-white/85 leading-relaxed font-medium drop-shadow">
                    {activeSlide?.bodyText}
                  </p>
                </div>

                {/* Slide Footer: Brand Logo & Watermark */}
                <div className="flex items-center justify-between pt-4 border-t border-white/10 z-10">
                  <div className="flex items-center gap-2">
                    {brandDna?.logoUrl ? (
                      <img
                        src={brandDna.logoUrl}
                        alt="Logo"
                        className="w-6 h-6 object-contain rounded"
                      />
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {brandDna?.companyName?.[0] || "C"}
                      </div>
                    )}
                    <span className="text-xs font-semibold text-white/90">
                      {brandDna?.companyName || "ContentOS"}
                    </span>
                  </div>

                  <span className="text-[11px] text-white/60 font-mono">
                    {brandDna?.websiteDomain || "swipe next →"}
                  </span>
                </div>

                {/* Subtle vignette overlay */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.6) 100%)",
                  }}
                />
              </div>

              {/* Prev / Next Slide Controls */}
              <div className="flex items-center gap-4 mt-4">
                <Button
                  variant="secondary"
                  onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeSlideIndex === 0}
                  className="text-xs px-3 py-1.5 flex items-center gap-1"
                >
                  <ChevronLeft size={14} />
                  <span>Prev</span>
                </Button>

                <span className="text-xs font-semibold text-[var(--muted)]">
                  Slide {activeSlideIndex + 1} of {slides.length}
                </span>

                <Button
                  variant="secondary"
                  onClick={() =>
                    setActiveSlideIndex((prev) =>
                      Math.min(slides.length - 1, prev + 1)
                    )
                  }
                  disabled={activeSlideIndex === slides.length - 1}
                  className="text-xs px-3 py-1.5 flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>

            {/* Right: Slide Copy Editor */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink)] flex items-center gap-2">
                    <Pencil size={13} className="text-orange-400" />
                    <span>Edit Slide #{activeSlideIndex + 1} Copy</span>
                  </h4>
                  <span className="text-[11px] text-[var(--muted)]">
                    Role: {activeSlide?.slideType || "CONTENT"}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                    Badge / Kicker
                  </label>
                  <input
                    type="text"
                    value={editBadge}
                    onChange={(e) => setEditBadge(e.target.value)}
                    placeholder="e.g. RULE #1 or KEY TAKEAWAY"
                    className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--ink)] focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                    Headline
                  </label>
                  <input
                    type="text"
                    value={editHeadline}
                    onChange={(e) => setEditHeadline(e.target.value)}
                    placeholder="Slide headline"
                    className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ink)] focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                    Body Narrative
                  </label>
                  <textarea
                    rows={4}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="Short, high-impact storytelling or actionable takeaway"
                    className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg p-2.5 text-xs text-[var(--ink)] focus:outline-none focus:border-orange-500 resize-y"
                  />
                </div>

                <Button
                  variant="primary"
                  onClick={handleSaveActiveSlide}
                  className="w-full py-2 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/20"
                >
                  <Save size={12} />
                  <span>Update Slide Copy</span>
                </Button>
              </div>

              {/* Instagram Caption & Hashtags Preview */}
              {carousel?.caption && (
                <div className="p-4 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-xs space-y-2">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-orange-400">
                    Instagram Post Caption:
                  </span>
                  <p className="text-[var(--ink)] whitespace-pre-line m-0 line-clamp-4">
                    {carousel.caption}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Horizontal Slide Timeline Navigator (Thumbnail Strip with Reordering) */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
              Slide Sequence Navigator (Reorder & Select):
            </span>

            <div className="flex items-center gap-3 overflow-x-auto pb-3">
              {slides.map((s, idx) => {
                const isSelected = idx === activeSlideIndex;
                return (
                  <div
                    key={s.id}
                    className={`shrink-0 w-36 rounded-xl border p-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? "border-orange-500 bg-orange-500/10 shadow-md shadow-orange-500/10"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-orange-500/40"
                    }`}
                    onClick={() => setActiveSlideIndex(idx)}
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-[var(--muted)] mb-1">
                      <span>#{idx + 1}</span>
                      <span className="uppercase tracking-wider text-[9px] text-orange-400">
                        {s.slideType}
                      </span>
                    </div>

                    <div className="text-xs font-bold text-[var(--ink)] line-clamp-2 mb-2 h-8">
                      {s.headline || "Slide"}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveSlide(idx, "left");
                        }}
                        disabled={idx === 0}
                        className="text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-20"
                        title="Move left"
                      >
                        <ArrowLeft size={11} />
                      </button>

                      <span className="text-[10px] text-[var(--muted)]">
                        {s.imageUrl ? "Ready" : "Draft"}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveSlide(idx, "right");
                        }}
                        disabled={idx === slides.length - 1}
                        className="text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-20"
                        title="Move right"
                      >
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

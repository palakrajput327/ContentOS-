import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Palette,
  Upload,
  Globe,
  Building2,
  Check,
  RefreshCw,
  Sparkles,
  Shield,
  Eye,
  Sliders,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { documentsApi, resolveMediaUrl, type DocumentBrandIdentity } from "../lib/api";
import { toast } from "sonner";

interface BrandIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentName?: string;
  sampleImageUrl?: string | null;
  onBrandUpdated?: (brand: DocumentBrandIdentity) => void;
}

export const BrandIdentityModal: React.FC<BrandIdentityModalProps> = ({
  isOpen,
  onClose,
  documentId,
  documentName = "Business Document",
  sampleImageUrl,
  onBrandUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recomposing, setRecomposing] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [websiteDomain, setWebsiteDomain] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState("#2563eb");
  const [applyToAllPosters, setApplyToAllPosters] = useState(true);
  const [logoPosition, setLogoPosition] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const [domainPosition, setDomainPosition] = useState<"bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-right">("bottom-center");
  const [logoSize, setLogoSize] = useState<"small" | "medium" | "large">("medium");
  const [safeMargin, setSafeMargin] = useState(32);
  const [status, setStatus] = useState<string>("PENDING_REVIEW");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Fetch or auto-detect brand identity on modal open
  useEffect(() => {
    if (!isOpen || !documentId) return;

    let mounted = true;
    setLoading(true);

    documentsApi
      .getBrandIdentity(documentId)
      .then((brand) => {
        if (!mounted) return;
        setCompanyName(brand.companyName || "");
        setLogoUrl(brand.logoUrl || null);
        setWebsiteDomain(brand.websiteDomain || "");
        setBrandColors(brand.brandColors || []);
        if (Array.isArray(brand.brandColors) && brand.brandColors.length > 0) {
          setBrandColors(brand.brandColors);
          setSelectedColor(brand.brandColors[0]);
        }
        setApplyToAllPosters(brand.applyToAllPosters ?? true);
        setLogoPosition(brand.logoPosition || "bottom-right");
        setDomainPosition(brand.domainPosition || "bottom-center");
        setLogoSize(brand.logoSize || "medium");
        setSafeMargin(brand.safeMargin || 32);
        setStatus(brand.status || "PENDING_REVIEW");
      })
      .catch((err) => {
        console.error("Failed to load brand identity:", err);
        toast.error("Could not load brand identity details.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, documentId]);

  if (!isOpen) return null;

  // Handle Logo File Upload (PNG / JPG / SVG / WebP)
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, SVG, WebP).");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Logo file size must be less than 5MB.");
      return;
    }

    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const res = await documentsApi.uploadBrandLogo(documentId, dataUrl, file.name);
        setLogoUrl(res.logoUrl);
        setStatus("PENDING_REVIEW");
        const detected = await documentsApi.getBrandIdentity(documentId);
        setBrandColors(detected.brandColors || []);
        toast.success("✅ Brand logo uploaded successfully!");
      } catch (err: any) {
        toast.error(err?.message || "Failed to upload logo.");
      } finally {
        setUploadingLogo(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Save Brand Identity
  const handleSave = async (shouldRecompose = false) => {
    setSaving(true);
    try {
      const updated = await documentsApi.updateBrandIdentity(documentId, {
        companyName,
        logoUrl,
        websiteDomain,
        brandColors,
        applyToAllPosters,
        logoPosition,
        domainPosition,
        logoSize,
        safeMargin,
        status: "CONFIRMED",
        recomposeExisting: shouldRecompose,
      });

      setStatus("CONFIRMED");
      if (onBrandUpdated) onBrandUpdated(updated);

      if (shouldRecompose) {
        toast.success("✨ Brand identity saved! Re-compositing all posters in the background...");
      } else {
        toast.success("✅ Brand identity saved successfully!");
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save brand identity.");
    } finally {
      setSaving(false);
    }
  };

  // Explicit Re-composite existing posters
  const handleRecomposePosters = async () => {
    setRecomposing(true);
    try {
      // First save latest settings
      await documentsApi.updateBrandIdentity(documentId, {
        companyName,
        logoUrl,
        websiteDomain,
        brandColors,
        applyToAllPosters,
        logoPosition,
        domainPosition,
        logoSize,
        safeMargin,
        status: "CONFIRMED",
      });

      const res = await documentsApi.recomposePosters(documentId);
      toast.success(`🎨 Successfully re-composited ${res.updatedCount || "all"} concept posters!`);
      if (onBrandUpdated) {
        const brand = await documentsApi.getBrandIdentity(documentId);
        onBrandUpdated(brand);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to re-composite posters.");
    } finally {
      setRecomposing(false);
    }
  };

  // Helper for Logo size style on preview
  const getLogoPreviewStyle = () => {
    let size = 64;
    if (logoSize === "small") size = 48;
    if (logoSize === "large") size = 88;

    const margin = 16;
    const style: React.CSSProperties = {
      position: "absolute",
      maxWidth: `${size}px`,
      maxHeight: `${size}px`,
      objectFit: "contain",
      zIndex: 10,
      padding: "6px",
      borderRadius: "8px",
      background: "rgba(15, 23, 42, 0.75)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
    };

    switch (logoPosition) {
      case "top-left":
        style.top = `${margin}px`;
        style.left = `${margin}px`;
        break;
      case "top-right":
        style.top = `${margin}px`;
        style.right = `${margin}px`;
        break;
      case "bottom-left":
        style.bottom = `${margin}px`;
        style.left = `${margin}px`;
        break;
      case "bottom-right":
      default:
        style.bottom = `${margin}px`;
        style.right = `${margin}px`;
        break;
    }

    return style;
  };

  // Helper for Domain pill on preview
  const getDomainPreviewStyle = () => {
    const margin = 16;
    const style: React.CSSProperties = {
      position: "absolute",
      zIndex: 10,
      padding: "6px 14px",
      borderRadius: "9999px",
      background: "rgba(15, 23, 42, 0.85)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(255, 255, 255, 0.25)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      color: "#ffffff",
      fontSize: "0.75rem",
      fontWeight: 600,
      letterSpacing: "0.02em",
    };

    switch (domainPosition) {
      case "top-center":
        style.top = `${margin}px`;
        style.left = "50%";
        style.transform = "translateX(-50%)";
        break;
      case "top-right":
        style.top = `${margin}px`;
        style.right = `${margin}px`;
        break;
      case "bottom-left":
        style.bottom = `${margin}px`;
        style.left = `${margin}px`;
        break;
      case "bottom-right":
        style.bottom = `${margin}px`;
        style.right = `${margin}px`;
        break;
      case "bottom-center":
      default:
        style.bottom = `${margin}px`;
        style.left = "50%";
        style.transform = "translateX(-50%)";
        break;
    }

    return style;
  };

  // Fallback demo poster artwork for live preview if no sample image URL is passed
  const previewBg = sampleImageUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80";

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(3, 7, 18, 0.82)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="brand-identity-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Brand Identity Integration"
        style={{
          width: "100%",
          maxWidth: "1040px",
          maxHeight: "92vh",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid rgba(99, 102, 241, 0.25)",
          borderRadius: "16px",
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 35px rgba(99, 102, 241, 0.15)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--studio-neutral-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, var(--surface2) 100%)",
            flexShrink: 0,
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(79, 70, 229, 0.35)",
              }}
            >
              <Palette size={20} color="var(--ink)" />
            </div>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--ink)" }}>
                  Brand Identity Integration
                </h3>
                {status === "CONFIRMED" ? (
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "var(--success)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <CheckCircle2 size={10} /> Active
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#fbbf24",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <AlertCircle size={10} /> Needs Review
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                Per-PDF branding for <strong style={{ color: "var(--studio-secondary)" }}>{documentName}</strong> • Review the extracted logo and domain, then save to enable automatic branding.
              </p>
            </div>
          </div>

          <button
            aria-label="Close Brand Identity"
            onClick={onClose}
            style={{
              background: "var(--studio-neutral-soft)",
              border: "1px solid var(--studio-neutral-border)",
              borderRadius: "8px",
              padding: "6px",
              cursor: "pointer",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        {loading ? (
          <div style={{ padding: "80px 20px", textAlign: "center", color: "var(--muted)" }}>
            <RefreshCw size={28} className="animate-spin" style={{ margin: "0 auto 12px", color: "#6366f1" }} />
            <p style={{ fontSize: "0.9rem", margin: 0 }}>Analyzing PDF & auto-detecting brand identity...</p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
              overflowY: "auto",
              overflowX: "hidden",
              minHeight: 0,
              flex: 1,
            }}
          >
            {/* Left Column: Form Controls */}
            <div
              style={{
                padding: "22px 24px",
                borderRight: "1px solid var(--studio-neutral-soft)",
                display: "flex",
                flexDirection: "column",
                gap: "18px",
              }}
            >
              {/* Company Name */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--studio-secondary)", marginBottom: "6px" }}>
                  <Building2 size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px", color: "var(--accent)" }} />
                  Company Name (Extracted from PDF)
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. TradeOrbit"
                  style={{
                    width: "100%",
                    height: "36px",
                    background: "var(--surface2)",
                    border: "1px solid var(--studio-neutral-border)",
                    borderRadius: "8px",
                    padding: "0 12px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Logo Upload & Preview */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--studio-secondary)", marginBottom: "6px" }}>
                  <Shield size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px", color: "var(--accent)" }} />
                  Company Logo (Extracted from PDF or Uploaded)
                </label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    padding: "10px 14px",
                    background: "var(--surface2)",
                    border: "1px dashed var(--studio-neutral-border)",
                    borderRadius: "10px",
                  }}
                >
                  <div
                    style={{
                      width: "60px",
                      height: "60px",
                      borderRadius: "8px",
                      background: "rgba(0, 0, 0, 0.4)",
                      border: "1px solid var(--studio-neutral-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {logoUrl ? (
                      <img
                        src={resolveMediaUrl(logoUrl) || logoUrl}
                        alt="Brand Logo"
                        style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }}
                      />
                    ) : (
                      <span style={{ fontSize: "0.65rem", color: "var(--muted)", textAlign: "center" }}>No Logo</span>
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingLogo}
                        style={{
                          height: "32px",
                          padding: "0 12px",
                          background: "rgba(99, 102, 241, 0.2)",
                          border: "1px solid rgba(99, 102, 241, 0.4)",
                          borderRadius: "6px",
                          color: "var(--accent)",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <Upload size={12} className={uploadingLogo ? "animate-spin" : ""} />
                        {uploadingLogo ? "Uploading..." : logoUrl ? "Replace Logo" : "Upload Logo"}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        style={{ display: "none" }}
                        onChange={handleLogoUpload}
                      />
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "var(--muted)" }}>
                      Supports transparent PNG, SVG, WebP, JPG. Never distorted by AI.
                    </p>
                  </div>
                </div>
              </div>

              {/* Website Domain */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--studio-secondary)", marginBottom: "6px" }}>
                  <Globe size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px", color: "var(--accent)" }} />
                  Website Domain (Printed on every poster with 100% spelling accuracy)
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={websiteDomain}
                    onChange={(e) => setWebsiteDomain(e.target.value)}
                    placeholder="e.g. www.tradeorbit.live"
                    style={{
                      width: "100%",
                      height: "36px",
                      background: "var(--surface2)",
                      border: "1px solid var(--studio-neutral-border)",
                      borderRadius: "8px",
                      padding: "0 12px",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "var(--muted)" }}>
                  Automatically formatted into a frosted luxury glass badge. Zero typos.
                </p>
              </div>

              {/* Brand Colors */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--studio-secondary)", marginBottom: "6px" }}>
                  <Palette size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px", color: "var(--accent)" }} />
                  Brand Colors (Detected from PDF / Logo)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {brandColors.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedColor(c)}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: c,
                        border: selectedColor === c ? "2px solid var(--ink)" : "1px solid var(--studio-neutral-border)",
                        cursor: "pointer",
                        boxShadow: selectedColor === c ? "0 0 10px var(--studio-neutral-border)" : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {selectedColor === c && <Check size={14} color="var(--ink)" />}
                    </button>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "6px" }}>
                    <input
                      type="color"
                      value={selectedColor}
                      onChange={(e) => {
                        setSelectedColor(e.target.value);
                        if (!brandColors.includes(e.target.value)) {
                          setBrandColors([e.target.value, ...brandColors.slice(0, 3)]);
                        }
                      }}
                      style={{
                        width: "32px",
                        height: "32px",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        background: "none",
                      }}
                    />
                    <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{selectedColor}</span>
                  </div>
                </div>
              </div>

              {/* Poster Composition Controls */}
              <div
                style={{
                  padding: "14px",
                  borderRadius: "10px",
                  background: "var(--surface2)",
                  border: "1px solid var(--studio-neutral-soft)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ink)" }}>
                    <Sliders size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px", color: "var(--studio-info)" }} />
                    Poster Positioning & Size Settings
                  </span>
                </div>

                {/* Logo Position */}
                <div>
                  <span style={{ fontSize: "0.72rem", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    Logo Corner Position
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "6px" }}>
                    {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setLogoPosition(pos)}
                        style={{
                          height: "30px",
                          borderRadius: "6px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          background: logoPosition === pos ? "rgba(99, 102, 241, 0.3)" : "var(--studio-neutral-soft)",
                          border: logoPosition === pos ? "1px solid #6366f1" : "1px solid var(--studio-neutral-soft)",
                          color: logoPosition === pos ? "var(--ink)" : "var(--muted)",
                          textTransform: "capitalize",
                        }}
                      >
                        {pos.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Domain Placement */}
                <div>
                  <span style={{ fontSize: "0.72rem", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    Website Domain Placement
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "6px" }}>
                    {(["bottom-center", "bottom-left", "bottom-right"] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setDomainPosition(pos)}
                        style={{
                          height: "30px",
                          borderRadius: "6px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          background: domainPosition === pos ? "rgba(6, 182, 212, 0.3)" : "var(--studio-neutral-soft)",
                          border: domainPosition === pos ? "1px solid #06b6d4" : "1px solid var(--studio-neutral-soft)",
                          color: domainPosition === pos ? "var(--ink)" : "var(--muted)",
                          textTransform: "capitalize",
                        }}
                      >
                        {pos === "bottom-center" ? "Bottom-Center ⭐" : pos.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo Size */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Logo Size</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {(["small", "medium", "large"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setLogoSize(s)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: "6px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          background: logoSize === s ? "rgba(99, 102, 241, 0.3)" : "var(--studio-neutral-soft)",
                          border: logoSize === s ? "1px solid #6366f1" : "1px solid var(--studio-neutral-soft)",
                          color: logoSize === s ? "var(--ink)" : "var(--muted)",
                          textTransform: "capitalize",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Apply branding to every poster toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                }}
              >
                <div>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--success)", display: "block" }}>
                    Apply branding to every poster
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                    Enabled by default. Automatically composites this identity onto all future generated artwork.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={applyToAllPosters}
                  onChange={(e) => setApplyToAllPosters(e.target.checked)}
                  style={{ width: "18px", height: "18px", accentColor: "#10b981", cursor: "pointer" }}
                />
              </div>
            </div>

            {/* Right Column: Live Poster Interactive Preview */}
            <div
              style={{
                padding: "22px 24px",
                display: "flex",
                flexDirection: "column",
                background: "var(--surface2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Eye size={13} color="var(--studio-info)" /> Live Composition Preview
                </span>
                <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Real-time 1024x1024 poster preview</span>
              </div>

              {/* Poster Canvas Preview Container */}
              <div className="studio-artwork-preview"
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: "12px",
                  overflow: "hidden",
                  boxShadow: "0 15px 35px rgba(0,0,0,0.6)",
                  border: "1px solid var(--studio-neutral-border)",
                  background: "#020617",
                }}
              >
                {/* Background Image */}
                <img
                  src={resolveMediaUrl(previewBg) || previewBg}
                  alt="Poster Preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />

                {/* Subtle vignette gradient to guarantee readability */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.35) 100%)",
                    pointerEvents: "none",
                  }}
                />

                {/* Overlaid Logo */}
                {applyToAllPosters && logoUrl && (
                  <img
                    src={resolveMediaUrl(logoUrl) || logoUrl}
                    alt="Logo Overlay"
                    style={getLogoPreviewStyle()}
                  />
                )}

                {/* Overlaid Domain Badge */}
                {applyToAllPosters && websiteDomain && (
                  <div style={getDomainPreviewStyle()}>
                    <span
                      style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: selectedColor || "var(--studio-info)",
                        display: "inline-block",
                      }}
                    />
                    <span>{websiteDomain.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                  </div>
                )}
              </div>

              {/* Info notice */}
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: "0.72rem",
                  color: "var(--muted)",
                  lineHeight: 1.4,
                  background: "var(--studio-neutral-soft)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--studio-neutral-soft)",
                }}
              >
                💡 <strong>Original Artwork Protected:</strong> The raw AI visual is preserved separately. Repositioning your logo or editing your domain re-composites in seconds without consuming image generation credits.
              </p>

              {/* Quick Re-composite existing posters */}
              <div style={{ marginTop: "auto", paddingTop: "16px" }}>
                <button
                  type="button"
                  onClick={handleRecomposePosters}
                  disabled={recomposing || saving}
                  style={{
                    width: "100%",
                    height: "36px",
                    background: "rgba(6, 182, 212, 0.15)",
                    border: "1px solid rgba(6, 182, 212, 0.35)",
                    borderRadius: "8px",
                    color: "#67e8f9",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <RefreshCw size={13} className={recomposing ? "animate-spin" : ""} />
                  {recomposing ? "Re-compositing queued posters..." : "Re-composite All Queued Posters Now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--studio-neutral-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface2)",
            flexShrink: 0,
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              height: "34px",
              padding: "0 16px",
              borderRadius: "8px",
              background: "var(--studio-neutral-soft)",
              border: "1px solid var(--studio-neutral-border)",
              color: "var(--studio-secondary)",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              style={{
                height: "34px",
                padding: "0 20px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)",
                border: "none",
                color: "var(--ink)",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(79, 70, 229, 0.4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Sparkles size={14} className={saving ? "animate-spin" : ""} />
              {saving ? "Saving..." : "Save & Apply Brand Identity"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};


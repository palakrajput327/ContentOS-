import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Upload,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Globe,
  Palette,
  Type,
  FileText,
  Building,
  Target,
  Megaphone,
} from "lucide-react";
import { ModalFrame, Button } from "./ui";
import { instagramStudioApi, type BrandDnaProfile, type DocItem } from "../lib/api";

interface BrandDnaModalProps {
  open: boolean;
  onClose: () => void;
  documents?: DocItem[];
  onBrandUpdated?: (brand: BrandDnaProfile) => void;
}

export function BrandDnaModal({ open, onClose, documents = [], onBrandUpdated }: BrandDnaModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [brand, setBrand] = useState<BrandDnaProfile | null>(null);

  // Form states
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [communicationTone, setCommunicationTone] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>(["#0f172a", "#f97316", "#38bdf8"]);
  const [typographyStyle, setTypographyStyle] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [websiteDomain, setWebsiteDomain] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [ctaStyle, setCtaStyle] = useState("");
  const [creativeGuidelines, setCreativeGuidelines] = useState("");
  const [logoPosition, setLogoPosition] = useState("top-right");
  const [selectedDocId, setSelectedDocId] = useState<string>("");

  useEffect(() => {
    if (open) {
      loadBrandDna();
    }
  }, [open]);

  const loadBrandDna = async () => {
    setLoading(true);
    try {
      const data = await instagramStudioApi.getBrandDna();
      setBrand(data);
      setCompanyName(data.companyName);
      setIndustry(data.industry);
      setTargetAudience(data.targetAudience);
      setCommunicationTone(data.communicationTone);
      setBrandColors(data.brandColors || ["#0f172a", "#f97316", "#38bdf8"]);
      setTypographyStyle(data.typographyStyle);
      setVisualStyle(data.visualStyle);
      setWebsiteDomain(data.websiteDomain);
      setPreferredLanguage(data.preferredLanguage || "English");
      setCtaStyle(data.ctaStyle);
      setCreativeGuidelines(data.creativeGuidelines);
      setLogoPosition(data.logoPosition || "top-right");
    } catch (err: any) {
      toast.error("Failed to load Brand DNA.");
    } finally {
      setLoading(false);
    }
  };

  const handleExtractFromDoc = async () => {
    setExtracting(true);
    try {
      const extracted = await instagramStudioApi.extractBrandDna({
        documentId: selectedDocId || undefined,
      });
      setBrand(extracted);
      setCompanyName(extracted.companyName);
      setIndustry(extracted.industry);
      setTargetAudience(extracted.targetAudience);
      setCommunicationTone(extracted.communicationTone);
      setBrandColors(extracted.brandColors);
      setTypographyStyle(extracted.typographyStyle);
      setVisualStyle(extracted.visualStyle);
      setWebsiteDomain(extracted.websiteDomain);
      setPreferredLanguage(extracted.preferredLanguage);
      setCtaStyle(extracted.ctaStyle);
      setCreativeGuidelines(extracted.creativeGuidelines);
      toast.success("Brand DNA extracted successfully! Please review and approve.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to extract Brand DNA.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveAndApprove = async (newStatus: "APPROVED" | "PENDING_REVIEW") => {
    setSaving(true);
    try {
      const updated = await instagramStudioApi.updateBrandDna({
        companyName,
        industry,
        targetAudience,
        communicationTone,
        brandColors,
        typographyStyle,
        visualStyle,
        websiteDomain,
        preferredLanguage,
        ctaStyle,
        creativeGuidelines,
        logoPosition,
        status: newStatus,
      });
      setBrand(updated);
      toast.success(newStatus === "APPROVED" ? "Brand DNA approved and activated!" : "Brand DNA changes saved.");
      onBrandUpdated?.(updated);
      if (newStatus === "APPROVED") {
        onClose();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to save Brand DNA.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const res = await instagramStudioApi.uploadBrandLogo(dataUrl, file.name);
        setBrand((prev) => (prev ? { ...prev, logoUrl: res.logoUrl, logoAssetId: res.logoAssetId, brandColors: res.brandColors } : null));
        setBrandColors(res.brandColors);
        toast.success("Logo uploaded & brand colors extracted!");
      } catch (err: any) {
        toast.error(err?.message || "Logo upload failed.");
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <ModalFrame open={open} onClose={onClose} title="Smart Brand DNA Profile" className="brand-dna-dialog">
      <div style={{ maxWidth: "720px", width: "100%", padding: "6px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                boxShadow: "0 4px 14px rgba(249, 115, 22, 0.35)",
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "var(--ink)" }}>
                Smart Brand DNA
              </h2>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Workspace brand intelligence automatically applied to all Instagram creatives & carousels
              </p>
            </div>
          </div>

          {/* Status Badge */}
          {brand && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "20px",
                fontSize: "0.75rem",
                fontWeight: 700,
                background: brand.status === "APPROVED" || brand.status === "ACTIVE" ? "rgba(16, 185, 129, 0.15)" : "rgba(249, 115, 22, 0.15)",
                color: brand.status === "APPROVED" || brand.status === "ACTIVE" ? "var(--success, #10b981)" : "#f97316",
                border: `1px solid ${brand.status === "APPROVED" || brand.status === "ACTIVE" ? "rgba(16, 185, 129, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
              }}
            >
              {brand.status === "APPROVED" || brand.status === "ACTIVE" ? (
                <>
                  <CheckCircle2 size={13} /> ACTIVE & APPROVED
                </>
              ) : (
                <>
                  <Clock size={13} /> PENDING APPROVAL
                </>
              )}
            </div>
          )}
        </div>

        {/* AI Auto-Extraction Bar */}
        <div
          style={{
            background: "var(--surface2, rgba(255, 255, 255, 0.03))",
            border: "1px dashed rgba(249, 115, 22, 0.35)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "200px" }}>
            <FileText size={18} style={{ color: "#f97316" }} />
            <div style={{ fontSize: "0.82rem" }}>
              <strong style={{ color: "var(--ink)", display: "block" }}>Auto-Extract from Knowledge Document</strong>
              <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                Select an uploaded PDF to auto-populate brand colors, tone, and audience
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {documents.length > 0 && (
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                style={{
                  background: "var(--surface, #1e293b)",
                  color: "var(--ink, #ffffff)",
                  border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: "0.8rem",
                  maxWidth: "180px",
                }}
              >
                <option value="">Latest document...</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.original_filename}
                  </option>
                ))}
              </select>
            )}

            <Button
              variant="secondary"
              onClick={handleExtractFromDoc}
              disabled={extracting}
              style={{ fontSize: "0.78rem", padding: "6px 12px" }}
            >
              <Sparkles size={13} style={{ color: "#f97316" }} />
              {extracting ? "Extracting..." : "Auto-Extract"}
            </Button>
          </div>
        </div>

        {/* Form Body */}
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            Loading Brand DNA...
          </div>
        ) : (
          <div style={{ maxHeight: "460px", overflowY: "auto", paddingRight: "4px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              {/* Company Name */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  <Building size={12} style={{ display: "inline", marginRight: "4px" }} /> Company / Brand Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. TradeOrbit"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              {/* Industry */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  <Target size={12} style={{ display: "inline", marginRight: "4px" }} /> Industry / Category
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Fintech, Web3, SaaS"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              {/* Target Audience */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  Target Audience
                </label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. High-net-worth investors, founders"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              {/* Communication Tone */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  <Megaphone size={12} style={{ display: "inline", marginRight: "4px" }} /> Brand Tone
                </label>
                <input
                  type="text"
                  value={communicationTone}
                  onChange={(e) => setCommunicationTone(e.target.value)}
                  placeholder="e.g. Authoritative, Visionary & Direct"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              {/* Website Domain */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  <Globe size={12} style={{ display: "inline", marginRight: "4px" }} /> Official Website Domain
                </label>
                <input
                  type="text"
                  value={websiteDomain}
                  onChange={(e) => setWebsiteDomain(e.target.value)}
                  placeholder="e.g. www.tradeorbit.world"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              {/* CTA Style */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                  Preferred CTA Style
                </label>
                <input
                  type="text"
                  value={ctaStyle}
                  onChange={(e) => setCtaStyle(e.target.value)}
                  placeholder="e.g. Swipe to Transform Your Portfolio"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--surface, #0f172a)",
                    border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    borderRadius: "8px",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>
            </div>

            {/* Brand Colors Palette */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "8px" }}>
                <Palette size={12} style={{ display: "inline", marginRight: "4px" }} /> Brand Palette (Primary, Secondary, Accent)
              </label>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                {brandColors.map((color, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "var(--surface, #0f172a)",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                    }}
                  >
                    <input
                      type="color"
                      value={color.length === 7 ? color : "#f97316"}
                      onChange={(e) => {
                        const next = [...brandColors];
                        next[idx] = e.target.value;
                        setBrandColors(next);
                      }}
                      style={{ width: "24px", height: "24px", border: "none", borderRadius: "4px", cursor: "pointer", background: "none" }}
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => {
                        const next = [...brandColors];
                        next[idx] = e.target.value;
                        setBrandColors(next);
                      }}
                      style={{
                        width: "72px",
                        background: "none",
                        border: "none",
                        color: "var(--ink)",
                        fontSize: "0.78rem",
                        fontFamily: "monospace",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Logo Section */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "var(--surface2, rgba(255, 255, 255, 0.03))",
                borderRadius: "10px",
                border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.08))",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "8px",
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid var(--studio-neutral-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {brand?.logoUrl ? (
                    <img src={brand.logoUrl} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  ) : (
                    <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>No logo</span>
                  )}
                </div>
                <div>
                  <strong style={{ fontSize: "0.85rem", color: "var(--ink)", display: "block" }}>Brand Logo Asset</strong>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Used for automatic watermark overlays on Instagram creatives & carousels
                  </span>
                </div>
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  background: "var(--surface, #1e293b)",
                  border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.15))",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  color: "var(--ink)",
                  fontWeight: 600,
                }}
              >
                <Upload size={13} />
                <span>Upload Logo</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoUpload} style={{ display: "none" }} />
              </label>
            </div>

            {/* Creative Guidelines */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>
                Creative & Visual Guidelines
              </label>
              <textarea
                rows={3}
                value={creativeGuidelines}
                onChange={(e) => setCreativeGuidelines(e.target.value)}
                placeholder="Key rules for image prompts and copywriting (e.g. 4:5 vertical framing, sharp typography, avoid cluttered text)"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--surface, #0f172a)",
                  border: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.1))",
                  borderRadius: "8px",
                  color: "var(--ink)",
                  fontSize: "0.82rem",
                  lineHeight: 1.45,
                }}
              />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid var(--studio-neutral-soft, rgba(255, 255, 255, 0.08))",
            paddingTop: "16px",
            marginTop: "16px",
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>

          <div style={{ display: "flex", gap: "10px" }}>
            <Button
              variant="secondary"
              onClick={() => handleSaveAndApprove("PENDING_REVIEW")}
              disabled={saving}
              style={{ fontSize: "0.82rem" }}
            >
              Save Draft
            </Button>

            <Button
              variant="primary"
              onClick={() => handleSaveAndApprove("APPROVED")}
              disabled={saving}
              style={{
                fontSize: "0.82rem",
                background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                border: "none",
                fontWeight: 600,
              }}
            >
              <ShieldCheck size={14} />
              {saving ? "Saving..." : "Approve & Activate DNA"}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}


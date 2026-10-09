import React, { useState } from "react";
import {
  X as CloseIcon,
  Send,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Code,
  Info,
  ShieldCheck,
} from "lucide-react";
import { Button, PlatformIcon } from "./ui";
import {
  PLATFORM_CAPABILITIES,
  normalizeVariant,
  validatePlatformVariant,
  type Platform,
  type PlatformVariant,
} from "../lib/platform-capabilities";

export interface PublishPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  body: string;
  platforms: Platform[];
  variants: Record<string, PlatformVariant>;
  youtube?: any;
  onConfirmPublish?: () => void;
  isPublishing?: boolean;
}

export function PublishPreviewModal({
  isOpen,
  onClose,
  title,
  body,
  platforms,
  variants,
  youtube,
  onConfirmPublish,
  isPublishing = false,
}: PublishPreviewModalProps) {
  const [activePlatform, setActivePlatform] = useState<Platform>(
    platforms[0] || "LinkedIn"
  );
  const [showJsonPayload, setShowJsonPayload] = useState(false);

  if (!isOpen) return null;

  const currentPlatform: Platform = (
    platforms.includes(activePlatform) ? activePlatform : platforms[0] || "LinkedIn"
  ) as Platform;
  const cap = PLATFORM_CAPABILITIES[currentPlatform];

  const rawVar = variants[currentPlatform];
  const variantObj = normalizeVariant(rawVar, body, title);

  // Apply YouTube fallback if platform is YouTube
  if (currentPlatform === "YouTube" && youtube) {
    if (!variantObj.title && youtube.title) variantObj.title = youtube.title;
    if (!variantObj.caption && youtube.description)
      variantObj.caption = youtube.description;
    if (!variantObj.mediaAssetId && youtube.assetId)
      variantObj.mediaAssetId = youtube.assetId;
    variantObj.mediaType = "video";
  }

  const validation = validatePlatformVariant(currentPlatform, variantObj, {
    isPublishing: true,
  });

  const finalTitle = cap?.supportsTitle
    ? variantObj.title || title || ""
    : "";
  const finalCaption = variantObj.caption || body || "";
  const mediaType = variantObj.mediaType || "text";

  const payloadJson = {
    platform: currentPlatform,
    destination: "Active Workspace Account",
    title: finalTitle,
    caption: finalCaption,
    media: {
      mediaAssetId: variantObj.mediaAssetId || null,
      mediaUrl: variantObj.mediaUrl || null,
      mediaType,
    },
    capabilities: {
      maxChars: cap?.maxCaptionLength,
      supportsTitle: cap?.supportsTitle,
      requiresMedia: cap?.requiresMedia,
    },
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review your post"
        className="modal-card"
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "760px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
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
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(99, 102, 241, 0.15)",
                color: "#818cf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                Review your post
              </h3>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: "0.8rem",
                  color: "var(--color-text-muted, #94a3b8)",
                }}
              >
                Check the caption and media for each selected channel before publishing.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close post review"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Platform Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 24px",
            background: "rgba(0, 0, 0, 0.2)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            overflowX: "auto",
          }}
        >
          {platforms.map((p) => {
            const isActive = currentPlatform === p;
            const pCap = PLATFORM_CAPABILITIES[p];
            const pRaw = variants[p];
            const pVar = normalizeVariant(pRaw, body, title);
            const pValid = validatePlatformVariant(p, pVar, { isPublishing: true }).valid;

            return (
              <button
                key={p}
                type="button"
                onClick={() => setActivePlatform(p)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: isActive
                    ? "1px solid #6366f1"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  background: isActive
                    ? "rgba(99, 102, 241, 0.25)"
                    : "rgba(255, 255, 255, 0.03)",
                  color: isActive ? "#fff" : "var(--color-text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <PlatformIcon platform={p} />
                {p}
                {pValid ? (
                  <CheckCircle2 size={13} style={{ color: "#34d399" }} />
                ) : (
                  <AlertTriangle size={13} style={{ color: "#f87171" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Payload Body Content */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Validation Status Box */}
          {!validation.valid ? (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: "0.85rem",
              }}
            >
              <strong style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <AlertTriangle size={16} /> Validation Warning for {currentPlatform}
              </strong>
              <ul style={{ margin: 0, paddingLeft: "20px" }}>
                {validation.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                color: "#34d399",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircle2 size={16} />
              <span>Content format checks passed for {currentPlatform}. Publishing may still require channel permissions and accessible media.</span>
            </div>
          )}

          {/* Platform Capability Summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "12px",
              background: "rgba(255, 255, 255, 0.02)",
              padding: "12px 16px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              fontSize: "0.8rem",
            }}
          >
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Max Caption</span>
              <strong style={{ color: "#f1f5f9" }}>{cap?.maxCaptionLength} chars</strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Title Support</span>
              <strong style={{ color: cap?.supportsTitle ? "#34d399" : "var(--color-text-muted)" }}>
                {cap?.supportsTitle ? (cap.requiresTitle ? "Required" : "Optional") : "Not Supported"}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Media Requirement</span>
              <strong style={{ color: cap?.requiresMedia ? "#fbbf24" : "#34d399" }}>
                {cap?.requiresMedia ? `${cap.requiredMediaType || "Image/Video"} Required` : "Optional"}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Current Length</span>
              <strong
                style={{
                  color: finalCaption.length > (cap?.maxCaptionLength || 0) ? "#ef4444" : "#f1f5f9",
                }}
              >
                {finalCaption.length} chars
              </strong>
            </div>
          </div>

          {/* Title Field if supported */}
          {cap?.supportsTitle && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
                Platform Post Title {cap.requiresTitle ? "(Required)" : "(Optional)"}
              </label>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "rgba(0, 0, 0, 0.3)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                {finalTitle || <em style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>No title set</em>}
              </div>
            </div>
          )}

          {/* Caption Box */}
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
              Caption
            </label>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                fontSize: "0.88rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {finalCaption || <em style={{ color: "var(--color-text-muted)" }}>Empty caption</em>}
            </div>
          </div>

          {/* Media Info */}
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
              Attached media
            </label>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.85rem",
              }}
            >
              {mediaType === "video" ? (
                <VideoIcon size={20} style={{ color: "#818cf8" }} />
              ) : mediaType === "image" ? (
                <ImageIcon size={20} style={{ color: "#34d399" }} />
              ) : (
                <FileText size={20} style={{ color: "var(--color-text-muted)" }} />
              )}
              <div>
                <strong style={{ display: "block" }}>{mediaType === 'text' ? 'Text only' : mediaType === 'image' ? 'Image with caption' : 'Video with caption'}</strong>
                {mediaType === 'image' && variantObj.mediaUrl && <img src={variantObj.mediaUrl} alt={`${currentPlatform} image preview`} style={{display:'block',maxWidth:'100%',maxHeight:200,objectFit:'contain',borderRadius:8,marginTop:8}} />}
              </div>
            </div>
          </div>

          {/* Toggle JSON View */}
          <div>
            <button
              type="button"
              className="text-button"
              style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "6px" }}
              onClick={() => setShowJsonPayload(!showJsonPayload)}
            >
              <Code size={14} />
              {showJsonPayload ? "Hide Raw JSON Payload" : "View Raw JSON Payload"}
            </button>
            {showJsonPayload && (
              <pre
                style={{
                  marginTop: "8px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "#020617",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  fontSize: "0.78rem",
                  color: "#a5b4fc",
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(payloadJson, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.2)",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            {platforms.length} selected channels · Results reported separately
          </span>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={onClose}>
              Close Preview
            </Button>
            {onConfirmPublish && (
              <Button
                variant="primary"
                onClick={onConfirmPublish}
                disabled={isPublishing}
              >
                <Send size={15} />
                {isPublishing ? "Publishing..." : "Confirm & Publish Now"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

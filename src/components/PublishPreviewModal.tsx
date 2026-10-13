import React, { useState, useRef, useEffect } from "react";
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
import { Button, PlatformIcon, ModalFrame } from "./ui";
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
  publishError?: string;
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
  publishError,
}: PublishPreviewModalProps) {
  const [activePlatform, setActivePlatform] = useState<Platform>(
    platforms[0] || "LinkedIn"
  );
  const [showJsonPayload, setShowJsonPayload] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (publishError && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [publishError]);

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
  const isInstagramAutoPoster =
    currentPlatform === "Instagram" &&
    !variantObj.mediaAssetId &&
    !variantObj.mediaUrl &&
    finalCaption.trim().length > 0;

  const isFormValid = validation.valid && finalCaption.trim().length > 0;

  const payloadJson = {
    platform: currentPlatform,
    destination: "Active Workspace Account",
    title: finalTitle,
    caption: finalCaption,
    media: {
      mediaAssetId: variantObj.mediaAssetId || null,
      mediaUrl: isInstagramAutoPoster ? "[Auto-Generated JPEG Text Card]" : (variantObj.mediaUrl || null),
      mediaType: isInstagramAutoPoster ? "image" : mediaType,
      autoPoster: isInstagramAutoPoster,
    },
    capabilities: {
      maxChars: cap?.maxCaptionLength,
      supportsTitle: cap?.supportsTitle,
      requiresMedia: cap?.requiresMedia,
    },
  };

  return (
    <ModalFrame open={isOpen} onClose={()=>{if(!isPublishing)onClose();}} title="Review your post" className="publish-dialog">
      <div
        className="modal-card"
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
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
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(99, 102, 241, 0.15)",
                color: "var(--accent)",
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
                  color: "var(--color-text-muted, var(--muted))",
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
            disabled={isPublishing}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: isPublishing ? "not-allowed" : "pointer",
              padding: "4px",
            }}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Sticky Real-time Publishing Error Banner */}
        {publishError && (
          <div
            role="alert"
            style={{
              padding: "14px 24px",
              background: "rgba(239, 68, 68, 0.2)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.4)",
              color: "var(--danger)",
              fontSize: "0.88rem",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ display: "block", fontSize: "0.9rem", marginBottom: "2px" }}>
                Publishing Failed
              </strong>
              <span>{publishError}</span>
            </div>
          </div>
        )}

        {/* Platform Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 24px",
            background: "var(--surface2)",
            borderBottom: "1px solid var(--border)",
            overflowX: "auto",
          }}
        >
          {platforms.map((p) => {
            const isActive = currentPlatform === p;
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
                  <CheckCircle2 size={13} style={{ color: "var(--success)" }} />
                ) : (
                  <AlertTriangle size={13} style={{ color: "var(--danger)" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Payload Body Content */}
        <div
          ref={scrollRef}
          style={{ padding: "24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}
        >
          {/* Real-time Publishing Error Banner */}
          {publishError && (
            <div
              role="alert"
              style={{
                padding: "14px 16px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "var(--danger)",
                fontSize: "0.88rem",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong style={{ display: "block", marginBottom: "3px" }}>Publishing Failed</strong>
                <span>{publishError}</span>
              </div>
            </div>
          )}

          {/* Validation Status Box */}
          {!validation.valid ? (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
                fontSize: "0.85rem",
              }}
            >
              <strong style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <AlertTriangle size={16} /> Validation Issues for {currentPlatform}
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
                color: "var(--success)",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircle2 size={16} />
              <span>
                {isInstagramAutoPoster
                  ? `Content format checks passed for ${currentPlatform}. Auto-poster will create a branded JPEG card from your caption.`
                  : `Content format checks passed for ${currentPlatform}. Ready to publish.`}
              </span>
            </div>
          )}

          {/* Platform Capability Summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "12px",
              background: "var(--surface2)",
              padding: "12px 16px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              fontSize: "0.8rem",
            }}
          >
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Max Caption</span>
              <strong style={{ color: "var(--ink)" }}>{cap?.maxCaptionLength} chars</strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Title Support</span>
              <strong style={{ color: cap?.supportsTitle ? "var(--success)" : "var(--color-text-muted)" }}>
                {cap?.supportsTitle ? (cap.requiresTitle ? "Required" : "Optional") : "Not Supported"}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Media Requirement</span>
              <strong style={{ color: cap?.requiresMedia ? "var(--warning)" : "var(--success)" }}>
                {isInstagramAutoPoster ? "Auto-Poster (JPEG Card)" : (cap?.requiresMedia ? `${cap.requiredMediaType || "Image/Video"} Required` : "Optional")}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)", display: "block" }}>Current Length</span>
              <strong
                style={{
                  color: !finalCaption.trim() ? "var(--danger)" : finalCaption.length > (cap?.maxCaptionLength || 0) ? "var(--danger)" : "var(--success)",
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
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
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
              Effective Caption
            </label>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                fontSize: "0.88rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {finalCaption || <em style={{ color: "var(--danger)" }}>Empty caption — Caption cannot be empty</em>}
            </div>
          </div>

          {/* Media Info */}
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
              Attached Media / Format
            </label>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.85rem",
              }}
            >
              {isInstagramAutoPoster ? (
                <ImageIcon size={20} style={{ color: "var(--accent)" }} />
              ) : mediaType === "video" ? (
                <VideoIcon size={20} style={{ color: "var(--accent)" }} />
              ) : mediaType === "image" ? (
                <ImageIcon size={20} style={{ color: "var(--success)" }} />
              ) : (
                <FileText size={20} style={{ color: "var(--color-text-muted)" }} />
              )}
              <div>
                <strong style={{ display: "block" }}>
                  {isInstagramAutoPoster
                    ? "Auto-generated JPEG text card (Auto-poster)"
                    : mediaType === "text"
                    ? "Text only"
                    : mediaType === "image"
                    ? "Image with caption"
                    : "Video with caption"}
                </strong>
                {isInstagramAutoPoster && (
                  <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                    Instagram requires media. ContentOS will render a high-quality JPEG image card from your text caption during publishing.
                  </p>
                )}
                {!isInstagramAutoPoster && mediaType === "image" && variantObj.mediaUrl && (
                  <img src={variantObj.mediaUrl} alt={`${currentPlatform} image preview`} style={{ display: "block", maxWidth: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, marginTop: 8 }} />
                )}
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
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  fontSize: "0.78rem",
                  color: "var(--accent)",
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
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "var(--surface2)",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            {platforms.length} selected channel(s) · Results reported separately
          </span>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={onClose} disabled={isPublishing}>
              Close Preview
            </Button>
            {onConfirmPublish && (
              <Button
                variant="primary"
                onClick={onConfirmPublish}
                disabled={isPublishing || !isFormValid}
                style={{
                  opacity: isPublishing || !isFormValid ? 0.6 : 1,
                  cursor: isPublishing || !isFormValid ? "not-allowed" : "pointer",
                }}
              >
                <Send size={15} />
                {isPublishing
                  ? `Publishing to ${platforms.length} channel(s)...`
                  : "Confirm & Publish Now"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

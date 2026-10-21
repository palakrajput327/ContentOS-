import { useEffect, useState } from "react";
import { toast } from "sonner";
import { request } from "../lib/api";
import { Button, ModalFrame } from "./ui";
import { SourceKnowledgeReview } from "./SourceKnowledgeReview";
import { SourcePosterDialog } from "./SourcePosterDialog";
import { useSession } from "../lib/session";
import "./document-source-media.css";

interface SourceMedia {
  status: string;
  message?: string;
  sourceUrl: string;
  visionAvailable?: boolean;
  storage?: {
    usedBytes: number;
    limitBytes: number;
    sourceMediaBytes: number;
    reservedBytes: number;
  };
  summary?: { filtered?: number; stored?: number; reused?: number };
  assets: Array<{
    assetId: string;
    sourceId?: string;
    previewOnly?: boolean;
    sizeBytes?: number;
    pageNumber: number;
    imageIndex: number;
    kind: string;
    url: string;
    reuseEligibility: string;
    analysis?: {
      ocrStatus: string;
      visionStatus: string;
      error?: string;
      processing?: boolean;
    };
  }>;
}
export function DocumentSourceMedia({
  documentId,
  documentStatus,
  canExtract,
  selectedAssetId,
  onKnowledgeChanged,
  onSelectVisual,
}: {
  documentId: string;
  documentStatus: string;
  canExtract: boolean;
  selectedAssetId?: string;
  onKnowledgeChanged?: (documentId: string) => void;
  onSelectVisual?: (visual: { assetId: string; url: string; filename: string }) => void;
}) {
  const demo = useSession((s) => s.demo);
  const [data, setData] = useState<SourceMedia | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [action, setAction] = useState<string | null>(null),
    [review, setReview] = useState<SourceMedia["assets"][number] | null>(null),
    [poster, setPoster] = useState<SourceMedia["assets"][number] | null>(null),
    [reuse, setReuse] = useState<SourceMedia["assets"][number] | null>(null),
    [rights, setRights] = useState(false);
  async function sourceAction(
    asset: SourceMedia["assets"][number],
    path: "analyze" | "reuse",
    body: unknown,
  ) {
    if (!asset.sourceId) return;
    setAction(asset.sourceId);
    setError("");
    try {
      const result = await request<{ error?: string }>(
        `/documents/${documentId}/source-media/${asset.sourceId}/${path}`,
        "POST",
        body,
      );
      if (result.error) setError(result.error);
      if (path === "analyze") onKnowledgeChanged?.(documentId);
      if (path === "reuse") setReuse(null);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAction(null);
    }
  }
  const [downloading, setDownloading] = useState<string | null>(null);
  async function downloadOriginal(sourceId: string, pageNumber: number) {
    setDownloading(sourceId);
    setError("");
    try {
      const workspaceId = useSession.getState().workspaceId;
      const apiBase = import.meta.env.VITE_API_BASE ?? "";
      const response = await fetch(
        `${apiBase}/api/v1/documents/${documentId}/source-media/${sourceId}/original`,
        {
          credentials: "include",
          headers: workspaceId ? { "X-Workspace-Id": workspaceId } : {},
        },
      );
      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ message: "Could not extract original image." }));
        throw new Error(error.message || "Could not extract original image.");
      }
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `source-page-${pageNumber}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not extract original image.",
      );
    } finally {
      setDownloading(null);
    }
  }
  async function extract() {
    setExtracting(true);
    setError("");
    try {
      await request(
        `/documents/${documentId}/source-media/extract`,
        "POST",
        {},
      );
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image extraction failed.");
    } finally {
      setExtracting(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    async function load() {
      if (demo) {
        setData({ status: "PENDING", sourceUrl: "", assets: [] });
        return;
      }
      try {
        const value = await request<SourceMedia>(
          `/documents/${documentId}/source-media`,
        );
        if (cancelled) return;
        setData(value);
        setError("");
        // Auto-select first extracted PDF image by default if none selected yet
        if (value.assets?.length > 0 && onSelectVisual && !selectedAssetId) {
          onSelectVisual({
            assetId: value.assets[0].assetId,
            url: value.assets[0].url,
            filename: `PDF page ${value.assets[0].pageNumber} visual`,
          });
        }
        // Refresh signed links while open as well as processing progress.
        timer = setTimeout(
          load,
          ["PENDING", "PROCESSING"].includes(value.status) ||
            value.assets.some((a) => a.analysis?.processing)
            ? 3000
            : 12 * 60 * 1000,
        );
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not load source images.",
          );
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId, documentStatus, demo, refresh]);
  return (
    <section className="source-media" aria-label="PDF source images">
      <div className="source-media-heading">
        <div>
          <h3>Source images</h3>
          <p>Compact previews, linked to the original PDF pages.</p>
        </div>
        <Button variant="secondary" onClick={() => setRefresh((x) => x + 1)}>
          Refresh
        </Button>
        {!demo && canExtract && (
          <Button
            disabled={extracting || data?.status === "PROCESSING"}
            onClick={extract}
          >
            {extracting
              ? "Extracting images…"
              : data?.assets.length
                ? "Re-extract images"
                : "Extract images"}
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p role="status">Loading source images…</p>
      ) : (
        <>
          {data.storage && (
            <p>
              Workspace storage: {(data.storage.usedBytes / 1048576).toFixed(1)}{" "}
              / {(data.storage.limitBytes / 1048576).toFixed(0)} MiB · PDF
              previews: {(data.storage.sourceMediaBytes / 1048576).toFixed(2)}{" "}
              MiB
              {data.storage.reservedBytes > 0
                ? ` · ${(data.storage.reservedBytes / 1048576).toFixed(1)} MiB reserved for uploads`
                : ""}
            </p>
          )}
          {!!data.summary?.filtered && (
            <p>
              {data.summary.filtered} small or near-blank image
              {data.summary.filtered === 1 ? "" : "s"} skipped. Original content
              remains in the PDF.
            </p>
          )}
          {data.status === "FAILED" && (
            <p role="status">
              Image extraction needs attention: {data.message} Available images
              are retained. Retry using Extract images above.
            </p>
          )}
          {!data.assets.length && (
            <p role="status">
              {data.status === "READY"
                ? "No useful image previews were found. The original PDF is preserved."
                : demo
                  ? "Source images are available for uploaded PDFs in your workspace."
                  : "Images will appear as PDF extraction runs. Older PDFs need extraction to run again."}
            </p>
          )}
          <div className="source-media-grid">
            {data.assets.map((a) => (
              <figure
                key={`${a.assetId}:${a.pageNumber}:${a.imageIndex}:${a.kind}`}
              >
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${a.kind === "PAGE_RENDER" ? "page rendition" : "source image"} from page ${a.pageNumber}`}
                >
                  <img
                    src={a.url}
                    loading="lazy"
                    alt={`PDF ${a.kind === "PAGE_RENDER" ? "page rendition" : "image"} from page ${a.pageNumber}`}
                  />
                </a>
                <figcaption>
                  <strong>
                    {a.kind === "PAGE_RENDER"
                      ? "Page rendition"
                      : "Embedded image"}
                  </strong>
                  <a
                    href={`${data.sourceUrl}#page=${a.pageNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source page {a.pageNumber} ↗
                  </a>
                  <span>
                    {a.reuseEligibility === "APPROVED"
                      ? "Approved for image reuse"
                      : a.reuseEligibility === "REJECTED"
                        ? "Image reuse disabled"
                        : "Reuse review pending"}
                  </span>
                  {a.analysis && (
                    <span>
                      OCR: {a.analysis.ocrStatus.toLowerCase()} · Visual
                      insights: {a.analysis.visionStatus.toLowerCase()}
                    </span>
                  )}
                  {a.analysis?.error && (
                    <span className="source-error">{a.analysis.error}</span>
                  )}
                  {a.previewOnly && (
                    <span>Compressed preview · original in PDF</span>
                  )}
                  {a.sourceId && (
                    <Button
                      variant="secondary"
                      disabled={downloading !== null}
                      onClick={() =>
                        downloadOriginal(a.sourceId!, a.pageNumber)
                      }
                    >
                      {downloading === a.sourceId
                        ? "Extracting original…"
                        : "Download original image"}
                    </Button>
                  )}
                  <Button
                    variant={selectedAssetId === a.assetId ? "secondary" : "primary"}
                    style={{
                      marginTop: "6px",
                      width: "100%",
                      borderColor: selectedAssetId === a.assetId ? "var(--success)" : undefined,
                      color: selectedAssetId === a.assetId ? "var(--success)" : undefined,
                      background: selectedAssetId === a.assetId ? "rgba(16, 185, 129, 0.15)" : undefined,
                    }}
                    onClick={() => {
                      onSelectVisual?.({
                        assetId: a.assetId,
                        url: a.url,
                        filename: `PDF page ${a.pageNumber} visual`,
                      });
                      toast.success(`Attached page ${a.pageNumber} visual as post creative!`);
                    }}
                  >
                    {selectedAssetId === a.assetId ? "✓ Active Post Visual (Default)" : "✨ Use as Post Visual"}
                  </Button>
                  {a.sourceId && (
                    <div className="source-card-actions">
                      {canExtract && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={!!action || !!a.analysis?.processing}
                            onClick={() =>
                              sourceAction(a, "analyze", {
                                includeVision: false,
                              })
                            }
                          >
                            {action === a.sourceId
                              ? "Processing…"
                              : "Read image text"}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              !!action ||
                              !!a.analysis?.processing ||
                              !data.visionAvailable
                            }
                            title={
                              !data.visionAvailable
                                ? "A vision-capable AI model needs to be configured. OCR is available."
                                : undefined
                            }
                            onClick={() =>
                              sourceAction(a, "analyze", {
                                includeVision: true,
                              })
                            }
                          >
                            Analyze visuals
                          </Button>
                        </>
                      )}
                      <Button
                        variant="secondary"
                        disabled={!!action}
                        onClick={() => setReview(a)}
                      >
                        Review knowledge
                      </Button>
                      {canExtract &&
                        (a.reuseEligibility === "APPROVED" ? (
                          <>
                            <Button
                              disabled={!!action}
                              onClick={() => setPoster(a)}
                            >
                              Use source image
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={!!action}
                              onClick={() =>
                                sourceAction(a, "reuse", { allowed: false })
                              }
                            >
                              Revoke reuse
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={!!action}
                            onClick={() => {
                              setRights(false);
                              setReuse(a);
                            }}
                          >
                            Approve image reuse
                          </Button>
                        ))}
                    </div>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
          {!!data.assets.length && (
            <p>
              Original PDFs remain the source of truth. Full-resolution images
              are extracted on demand without storing another copy. Promotional
              reuse still requires review.
            </p>
          )}
        </>
      )}
      {review?.sourceId && (
        <SourceKnowledgeReview
          documentId={documentId}
          sourceId={review.sourceId}
          imageUrl={review.url}
          pageNumber={review.pageNumber}
          canEdit={canExtract}
          sourcePageUrl={
            data?.sourceUrl
              ? `${data.sourceUrl}#page=${review.pageNumber}`
              : undefined
          }
          onClose={() => setReview(null)}
          onChanged={() => onKnowledgeChanged?.(documentId)}
        />
      )}
      {poster?.sourceId && (
        <SourcePosterDialog
          documentId={documentId}
          sourceId={poster.sourceId}
          imageUrl={poster.url}
          pageNumber={poster.pageNumber}
          onClose={() => setPoster(null)}
        />
      )}
      {reuse?.sourceId && (
        <ModalFrame
          open
          title="Approve source image reuse"
          onClose={() => {
            if (!action) setReuse(null);
          }}
          className="source-reuse-dialog"
        >
          <div className="source-dialog-header">
            <h2>Approve image reuse</h2>
            <Button
              variant="secondary"
              disabled={!!action}
              onClick={() => setReuse(null)}
            >
              Close
            </Button>
          </div>
          <div className="source-reuse-body">
            <img
              src={reuse.url}
              alt={`Source image from page ${reuse.pageNumber}`}
            />
            <p>
              This approval allows using this source image in workspace
              creatives. Extracted facts and final posts are reviewed
              separately.
            </p>
            <label>
              <input
                type="checkbox"
                checked={rights}
                disabled={!!action}
                onChange={(e) => setRights(e.target.checked)}
              />
              My workspace owns this image or has permission to use it in
              promotional content.
            </label>
            <Button
              disabled={!rights || !!action}
              onClick={() =>
                sourceAction(reuse, "reuse", {
                  allowed: true,
                  rightsConfirmed: true,
                })
              }
            >
              Approve image reuse
            </Button>
          </div>
        </ModalFrame>
      )}
    </section>
  );
}

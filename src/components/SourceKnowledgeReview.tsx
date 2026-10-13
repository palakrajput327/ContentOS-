import { useEffect, useState } from "react";
import { documentsApi, request, type KnowledgeItem } from "../lib/api";
import { Button, ModalFrame } from "./ui";
import { useQueryClient } from "@tanstack/react-query";

export function SourceKnowledgeReview({
  documentId,
  sourceId,
  imageUrl,
  pageNumber,
  canEdit,
  sourcePageUrl,
  onClose,
  onChanged,
}: {
  documentId: string;
  sourceId: string;
  imageUrl: string;
  pageNumber: number;
  canEdit: boolean;
  sourcePageUrl?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const query = useQueryClient(),
    [items, setItems] = useState<KnowledgeItem[]>([]),
    [values, setValues] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let canceled = false;
    documentsApi
      .listKnowledge(documentId)
      .then((rows) => {
        if (canceled) return;
        const selected = rows.filter(
          (k) => k.metadata?.sourceReferenceId === sourceId,
        );
        setItems(selected);
        setValues(
          Object.fromEntries(
            selected.map((k) => [
              k.id,
              typeof k.value === "string" ? k.value : JSON.stringify(k.value),
            ]),
          ),
        );
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [documentId, sourceId]);
  async function review(item: KnowledgeItem, status: "CONFIRMED" | "REJECTED") {
    setBusy(true);
    setError("");
    try {
      await request(`/documents/${documentId}/knowledge/${item.id}`, "PATCH", {
        status,
        ...(status === "CONFIRMED" ? { value: values[item.id] } : {}),
      });
      setItems((rows) =>
        rows.map((k) =>
          k.id === item.id ? { ...k, status, value: values[item.id] } : k,
        ),
      );
      await query.invalidateQueries({ queryKey: ["knowledge-automation"] });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalFrame
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Review visual knowledge"
      className="source-review-dialog"
    >
      <div className="source-dialog-header">
        <div>
          <h2>Review visual knowledge</h2>
          <p>
            Source page {pageNumber} · Check every extracted claim against the
            image.
          </p>
          {sourcePageUrl && (
            <a href={sourcePageUrl} target="_blank" rel="noopener noreferrer">
              Open original PDF page ↗
            </a>
          )}
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={onClose}
          aria-label="Close visual knowledge review"
        >
          Close
        </Button>
      </div>
      <div className="source-review-grid">
        <img
          className="source-evidence-image"
          src={imageUrl}
          alt={`Evidence from PDF page ${pageNumber}`}
        />
        <div>
          {error && (
            <p role="alert" className="source-error">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">Loading visual knowledge…</p>
          ) : !items.length ? (
            <p>
              No extracted visual knowledge for this image yet. Read image text
              or analyze visuals, then review any results against the source.
            </p>
          ) : (
            items.map((item) => (
              <div className="source-review-item" key={item.id}>
                <div className="source-review-label">
                  <strong>
                    {item.metadata?.evidenceKind === "OCR_TEXT"
                      ? "OCR text"
                      : "AI visual observation"}
                  </strong>
                  <span>{item.status}</span>
                </div>
                <p>
                  {item.metadata?.evidenceKind === "OCR_TEXT"
                    ? "Text read from the source image; check OCR errors."
                    : "An interpretation of visible evidence; confirm only what the image supports."}
                </p>
                <textarea
                  aria-label={`Review ${item.metadata?.evidenceKind === "OCR_TEXT" ? "OCR text" : "visual observation"}`}
                  value={values[item.id] || ""}
                  maxLength={1800}
                  rows={4}
                  disabled={!canEdit || busy || item.status === "LOCKED"}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [item.id]: e.target.value }))
                  }
                />
                {canEdit && item.status !== "LOCKED" && (
                  <div className="source-card-actions">
                    <Button
                      disabled={busy || !values[item.id]?.trim()}
                      onClick={() => review(item, "CONFIRMED")}
                    >
                      Save & approve
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => review(item, "REJECTED")}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

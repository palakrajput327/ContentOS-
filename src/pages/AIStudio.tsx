import React, { useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles,
  FileText,
  Upload,
  Layers,
  Check,
  RotateCw,
  Save,
  Send,
  AlertCircle,
  FileCheck,
  Quote,
  Sliders,
  CheckSquare,
  Square,
  HelpCircle,
  ChevronRight,
  ExternalLink,
  BookOpen,
  Info,
  Clock,
  ThumbsUp,
  MessageSquare,
  Share2,
  Trash2,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request, documentsApi, type DocItem, type KnowledgeItem } from "../lib/api";
import { useSession } from "../lib/session";
import { PublishPreviewModal } from "../components/PublishPreviewModal";
import { BatchProgressIndicator } from "../components/BatchProgressIndicator";

export default function AIStudio() {
  const s = useOutletContext<Snapshot>();
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Studio Mode: 'topic' | 'pdf'
  const [activeTab, setActiveTab] = useState<"topic" | "pdf">("topic");

  // Topic Mode state
  const [topic, setTopic] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    "LinkedIn",
    "X",
    "Instagram",
  ]);
  const [tone, setTone] = useState(s?.brand?.tone || "Professional");
  const [goal, setGoal] = useState("Engagement");
  const [audience, setAudience] = useState("General Professional");

  // PDF Mode state
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<DocItem | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [extractingKnowledge, setExtractingKnowledge] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [generatedVariants, setGeneratedVariants] = useState<Partial<Record<Platform, string>>>({});
  const [activePreviewPlatform, setActivePreviewPlatform] = useState<Platform>("LinkedIn");

  // Platform limits mapping
  const platformLimits: Record<Platform, number> = {
    LinkedIn: 3000,
    Instagram: 2200,
    X: 280,
    Telegram: 4096,
    YouTube: 5000,
  };

  // Load existing documents when PDF tab is active
  useEffect(() => {
    if (activeTab === "pdf") {
      fetchDocuments();
    }
  }, [activeTab]);

  // Poll active document status if QUEUED or PROCESSING
  useEffect(() => {
    if (!selectedDocId || activeTab !== "pdf") return;

    let timer: NodeJS.Timeout;
    const checkDoc = async () => {
      try {
        const doc = await documentsApi.get(selectedDocId);
        setActiveDoc(doc);
        if (doc.status === "READY") {
          // Load knowledge automatically when document is ready
          fetchKnowledge(selectedDocId);
        } else if (doc.status === "QUEUED" || doc.status === "PROCESSING") {
          timer = setTimeout(checkDoc, 3000);
        }
      } catch (err) {
        console.error("Doc status check error:", err);
      }
    };

    checkDoc();
    return () => clearTimeout(timer);
  }, [selectedDocId, activeTab]);

  async function fetchDocuments() {
    try {
      setLoadingDocs(true);
      const docs = await documentsApi.list();
      setDocuments(docs);
      if (docs.length > 0 && !selectedDocId) {
        setSelectedDocId(docs[0].id);
        setActiveDoc(docs[0]);
        if (docs[0].status === "READY") {
          fetchKnowledge(docs[0].id);
        }
      }
    } catch (err) {
      console.error("Error fetching documents:", err);
    } finally {
      setLoadingDocs(false);
    }
  }

  async function fetchKnowledge(docId: string) {
    try {
      setLoadingKnowledge(true);
      const items = await documentsApi.listKnowledge(docId);
      setKnowledgeItems(items);
      // Select all confirmed items by default
      setSelectedKnowledgeIds(items.map((k) => k.id));
    } catch (err) {
      console.error("Error fetching knowledge:", err);
    } finally {
      setLoadingKnowledge(false);
    }
  }

  async function handleDeleteDocument(docId: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    try {
      await documentsApi.delete(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (selectedDocId === docId) {
        setSelectedDocId(null);
        setActiveDoc(null);
        setKnowledgeItems([]);
        setSelectedKnowledgeIds([]);
      }
      toast.success("PDF document deleted / canceled");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete PDF document");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      toast.error("Please select a PDF file.");
      return;
    }

    try {
      setUploadingPdf(true);
      setError(null);
      const res = await documentsApi.uploadPdf(file);
      toast.success(`PDF uploaded: ${file.name}`);
      setSelectedDocId(res.documentId);
      await fetchDocuments();
      if (res.status === "READY") {
        await fetchKnowledge(res.documentId);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploadingPdf(false);
    }
  }

  async function handleTriggerKnowledgeExtract() {
    if (!selectedDocId) return;
    try {
      setExtractingKnowledge(true);
      setError(null);
      await documentsApi.extractKnowledge(selectedDocId);
      toast.success("Knowledge extraction started.");
      // Fetch knowledge items
      setTimeout(() => {
        fetchKnowledge(selectedDocId);
      }, 1500);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setExtractingKnowledge(false);
    }
  }

  function togglePlatform(p: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
    if (!selectedPlatforms.includes(p) && selectedPlatforms.length === 0) {
      setActivePreviewPlatform(p);
    }
  }

  function toggleKnowledgeSelect(id: string) {
    setSelectedKnowledgeIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  async function handleGeneratePosts() {
    try {
      setError(null);
      if (!selectedPlatforms.length) {
        throw new Error("Please select at least one social platform.");
      }

      let promptTopic = topic.trim();
      if (activeTab === "pdf") {
        const selectedItems = knowledgeItems.filter((k) =>
          selectedKnowledgeIds.includes(k.id)
        );
        if (!selectedItems.length) {
          throw new Error(
            "Please select at least one extracted knowledge item or claim from the PDF."
          );
        }
        const knowledgeSummary = selectedItems
          .map(
            (k, idx) =>
              `Point ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)} ${
                k.source_excerpt ? `[Source: "${k.source_excerpt}" Page ${k.page_start || 1}]` : ""
              }`
          )
          .join("\n");
        promptTopic = `Generate social media posts based on the following verified PDF knowledge and evidence:\n\nDocument: ${
          activeDoc?.original_filename || "Attached PDF"
        }\nTarget Audience: ${audience}\n\nExtracted Knowledge & Evidence:\n${knowledgeSummary}`;
      } else {
        if (promptTopic.length < 5) {
          throw new Error("Please provide a topic or prompt of at least 5 characters.");
        }
      }

      setIsGenerating(true);
      let result: { title: string; variants: Partial<Record<Platform, string>> } = {
        title: "AI Studio Post",
        variants: {},
      };

      if (demo) {
        const mockVariants: Partial<Record<Platform, string>> = {};
        for (const p of selectedPlatforms) {
          if (p === "X") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `📊 New insights from ${activeDoc?.original_filename || "PDF"}:\n• 74% reduction in content adaptation overhead\n• 3.5x publication velocity boost\n\nWhat's your team's biggest publishing bottleneck?`
                : `${promptTopic.slice(0, 140)}\n\nOne actionable takeaway for your team today.`;
          } else if (p === "LinkedIn") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `Company knowledge deserves a life beyond static PDF documents.\n\nKey takeaways from "${activeDoc?.original_filename || "Product Strategy"}":\n\n1. Content Velocity: Structured platform scheduling increases workflow speed by 3.5x.\n2. Adaptation Savings: Benchmarks across 120 marketing teams showed 74% reduction in manual copy adaptation time.\n3. Brand Compliance: Real-time AI guardrails prevent unapproved phrasing before submission.\n\n${s.brand.cta}`
                : `Let's talk about ${promptTopic}.\n\nMeaningful progress starts with clear structure and deliberate execution. Share what you learn, empower your team, and build on ideas that deliver impact.\n\n${s.brand.cta}`;
          } else if (p === "Instagram") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `Turn your team's whitepapers into bite-sized social insights. ✨\n\nKey facts extracted from our latest document:\n- 3.5x publication throughput\n- 74% time saved on adaptation\n- 100% brand voice alignment\n\nSave this for your next team sprint! 🚀\n\n${s.brand.hashtags}`
                : `${promptTopic}\n\nA fresh perspective for your next creative session. Save this post for reference.\n\n${s.brand.hashtags}`;
          } else if (p === "Telegram") {
            mockVariants[p] =
              activeTab === "pdf"
                ? `📢 **Document Highlight**: ${activeDoc?.original_filename || "PDF Overview"}\n\nWe extracted key evidence from our whitepaper:\n• 74% lower copy adaptation time\n• Real-time brand safety guardrails\n• Verified page citations\n\nWhat topics should we cover next?`
                : `Hello community! Here is a breakdown of ${promptTopic.toLowerCase()}.\n\nWhat has worked best for your team? Share your thoughts below.`;
          } else {
            mockVariants[p] = `Deep Dive: ${promptTopic}\n\nIn this video description, we break down actionable steps and key performance metrics to help your team succeed.`;
          }
        }

        result = {
          title:
            activeTab === "pdf"
              ? `PDF Insights: ${activeDoc?.original_filename.replace(/\.pdf$/i, "") || "Knowledge"}`
              : topic.slice(0, 60),
          variants: mockVariants,
        };
        toast.info("Generated captions loaded for preview.");
      } else {
        result = await request("/ai/captions", "POST", {
          topic: promptTopic,
          tone,
          goal,
          platforms: selectedPlatforms,
        });
      }

      setGeneratedTitle(result.title || "AI Studio Post");
      setGeneratedVariants(result.variants || {});
      setActivePreviewPlatform(selectedPlatforms[0] || "LinkedIn");
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  }

  // Batch Generation State
  const [batchGenerationId, setBatchGenerationId] = useState<string | null>(null);

  async function handleBatchGenerateFromKnowledge() {
    try {
      setError(null);
      const selectedItems = knowledgeItems.filter((k) =>
        selectedKnowledgeIds.includes(k.id)
      );

      if (!selectedItems.length) {
        throw new Error("Select at least one knowledge item for batch generation.");
      }

      setIsGenerating(true);
      const itemsPayload = selectedItems.map((k, idx) => ({
        topic: `Knowledge Item ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)} ${k.source_excerpt ? `[Source: "${k.source_excerpt}"]` : ""}`,
        tone,
        goal,
        platforms: selectedPlatforms,
      }));

      const res = (await request("/batch/ai-generation", "POST", {
        items: itemsPayload,
      })) as { batchId: string };

      setBatchGenerationId(res.batchId);
      toast.success(`Started batch AI generation for ${selectedItems.length} knowledge items!`);
    } catch (err: any) {
      setError(err.message || "Batch generation failed.");
      toast.error(err.message || "Batch generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveToLibrary() {
    try {
      setError(null);
      if (!generatedTitle.trim() || !Object.keys(generatedVariants).length) {
        throw new Error("No generated content available to save.");
      }

      setIsSaving(true);
      const firstPlatform = selectedPlatforms[0] || "LinkedIn";
      const baseBody = generatedVariants[firstPlatform] || Object.values(generatedVariants)[0] || "";

      const saved = await data.save({
        title: generatedTitle,
        body: baseBody,
        platforms: selectedPlatforms,
        variants: generatedVariants,
      });

      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Post saved to Content Library as Draft!");
      nav("/app/library");
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="ai-studio-container" style={{ paddingBottom: "40px" }}>
      {/* Active Batch Progress Indicator */}
      {batchGenerationId && (
        <BatchProgressIndicator
          batchId={batchGenerationId}
          onComplete={() => {
            query.invalidateQueries({ queryKey: ["workspace"] });
            toast.success("Batch generation finished! Check Library for generated drafts.");
          }}
        />
      )}

      {/* Page Header */}
      <div className="page-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span
              className="badge"
              style={{
                background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(16, 185, 129, 0.2))",
                color: "#a5b4fc",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                fontWeight: 600,
                fontSize: "0.75rem",
                letterSpacing: "0.05em",
                padding: "4px 10px",
                borderRadius: "20px",
              }}
            >
              <Sparkles size={13} style={{ display: "inline", marginRight: "4px" }} /> AI STUDIO + KNOWLEDGE
            </span>
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 6px" }}>
            AI Studio & PDF-to-Content Workflow
          </h1>
          <p style={{ color: "var(--color-text-muted, #94a3b8)", margin: 0 }}>
            Transform topic prompts or verified PDF documents into tailored social media posts.
          </p>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      <div
        className="studio-tabs"
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          background: "rgba(255, 255, 255, 0.03)",
          padding: "6px",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          width: "fit-content",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("topic")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "topic" ? "var(--color-accent, #6366f1)" : "transparent",
            color: activeTab === "topic" ? "#fff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <FileText size={17} />
          Topic & Prompt Mode
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("pdf")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "pdf" ? "var(--color-accent, #6366f1)" : "transparent",
            color: activeTab === "pdf" ? "#fff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <BookOpen size={17} />
          PDF-to-Content Workflow
          <span
            style={{
              background: "rgba(16, 185, 129, 0.2)",
              color: "#34d399",
              fontSize: "0.7rem",
              padding: "2px 6px",
              borderRadius: "10px",
              marginLeft: "4px",
            }}
          >
            Evidence Engine
          </span>
        </button>
      </div>

      <div className="composer-grid" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "24px" }}>
        {/* Main Creation Column */}
        <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {activeTab === "topic" ? (
            /* TOPIC MODE PANEL */
            <div className="panel" style={{ padding: "24px" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={18} style={{ color: "#6366f1" }} />
                Describe Your Content Idea
              </h2>
              <div className="composer-fields" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <label>
                  Topic or Key Idea
                  <textarea
                    rows={4}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Launched our new real-time AI publishing workflow. Reduced content distribution overhead by 70% for marketing teams."
                    style={{ width: "100%", marginTop: "6px" }}
                  />
                </label>

                <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                  <label>
                    Brand Tone
                    <select value={tone} onChange={(e) => setTone(e.target.value)}>
                      {["Professional", "Bold", "Educational", "Conversational", "Technical", "Promotional"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Strategic Goal
                    <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                      {["Awareness", "Engagement", "Leads", "Website Traffic", "Product Launch"].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target Audience
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g. Product Managers"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            /* PDF MODE PANEL */
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* PDF Upload & Document Selector Panel */}
              <div className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <div>
                    <h2 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                      <BookOpen size={18} style={{ color: "#10b981" }} />
                      PDF Knowledge & Document Processing
                    </h2>
                    <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                      Upload whitepapers, research reports, or specs to extract verifiable claims and insights.
                    </p>
                  </div>
                </div>

                {/* Upload Dropzone */}
                <div
                  style={{
                    border: "2px dashed rgba(255, 255, 255, 0.15)",
                    borderRadius: "12px",
                    padding: "24px",
                    textAlign: "center",
                    background: "rgba(255, 255, 255, 0.02)",
                    marginBottom: "20px",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Upload size={32} style={{ color: "#6366f1", marginBottom: "10px" }} />
                  <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Upload PDF Document</h4>
                  <p style={{ margin: "0 0 14px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    Supports PDF documents up to 50MB. Extract structured claims with page citations.
                  </p>
                  <label className="button primary" style={{ cursor: uploadingPdf ? "wait" : "pointer", display: "inline-flex", gap: "8px" }}>
                    <Upload size={15} />
                    {uploadingPdf ? "Uploading & Initializing..." : "Select PDF File"}
                    <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploadingPdf} onChange={handleFileUpload} />
                  </label>
                </div>

                {/* Documents List */}
                {documents.length > 0 && (
                  <div>
                    <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "8px", display: "block" }}>
                      Workspace PDF Documents ({documents.length})
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
                      {documents.map((doc) => (
                        <div
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocId(doc.id);
                            setActiveDoc(doc);
                            if (doc.status === "READY") fetchKnowledge(doc.id);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            background: selectedDocId === doc.id ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.03)",
                            border: selectedDocId === doc.id ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid rgba(255, 255, 255, 0.06)",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                            <FileText size={18} style={{ color: "#6366f1", flexShrink: 0 }} />
                            <span style={{ fontSize: "0.85rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {doc.original_filename}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                background:
                                  doc.status === "READY"
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : doc.status === "FAILED"
                                    ? "rgba(239, 68, 68, 0.15)"
                                    : "rgba(245, 158, 11, 0.15)",
                                color:
                                  doc.status === "READY"
                                    ? "#34d399"
                                    : doc.status === "FAILED"
                                    ? "#f87171"
                                    : "#fbbf24",
                              }}
                            >
                              {doc.status}
                            </span>
                            {doc.page_count && (
                              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                                {doc.page_count} pages
                              </span>
                            )}
                            <button
                              type="button"
                              title="Delete / Cancel document"
                              onClick={(e) => handleDeleteDocument(doc.id, e)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#ef4444",
                                cursor: "pointer",
                                padding: "4px",
                                borderRadius: "4px",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Document Status & Knowledge Extract Action */}
                {activeDoc && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "14px",
                      borderRadius: "8px",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "0.9rem", display: "block" }}>{activeDoc.original_filename}</strong>
                      <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                        Status: <strong>{activeDoc.status}</strong> {activeDoc.page_count ? `• ${activeDoc.page_count} pages` : ""}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {activeDoc.status === "READY" ? (
                        <Button
                          onClick={handleTriggerKnowledgeExtract}
                          disabled={extractingKnowledge || loadingKnowledge}
                          style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                        >
                          <RotateCw size={14} className={extractingKnowledge ? "animate-spin" : ""} />
                          {extractingKnowledge ? "Extracting..." : "Re-extract Knowledge"}
                        </Button>
                      ) : (
                        <>
                          <span style={{ fontSize: "0.8rem", color: "#fbbf24", display: "flex", alignItems: "center", gap: "6px" }}>
                            <Clock size={14} className="animate-spin" /> Processing PDF...
                          </span>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setActiveDoc((prev) => prev ? { ...prev, status: "READY", page_count: prev.page_count || 12 } : null);
                              setDocuments((prev) =>
                                prev.map((d) => (d.id === activeDoc.id ? { ...d, status: "READY", page_count: d.page_count || 12 } : d))
                              );
                              fetchKnowledge(activeDoc.id);
                              toast.success("Fast-tracked PDF to READY status!");
                            }}
                            style={{ fontSize: "0.8rem", padding: "4px 10px", border: "1px solid rgba(16, 185, 129, 0.4)", color: "#34d399", background: "rgba(16, 185, 129, 0.1)" }}
                          >
                            <Sparkles size={14} /> Fast-Track to READY
                          </Button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={(e) => handleDeleteDocument(activeDoc.id, e)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: "#f87171",
                          fontSize: "0.8rem",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={14} />
                        {activeDoc.status === "QUEUED" || activeDoc.status === "PROCESSING" ? "Cancel & Delete" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Extracted Knowledge & Evidence Panel */}
              <div className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                      <Quote size={18} style={{ color: "#34d399" }} />
                      Extracted Knowledge & Evidence ({knowledgeItems.length})
                    </h3>
                    <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                      Select the verified claims, statistics, or summaries to feed into your social post generator.
                    </p>
                  </div>
                  {knowledgeItems.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      style={{ fontSize: "0.8rem" }}
                      onClick={() => {
                        if (selectedKnowledgeIds.length === knowledgeItems.length) {
                          setSelectedKnowledgeIds([]);
                        } else {
                          setSelectedKnowledgeIds(knowledgeItems.map((k) => k.id));
                        }
                      }}
                    >
                      {selectedKnowledgeIds.length === knowledgeItems.length ? "Deselect All" : "Select All"}
                    </button>
                  )}
                </div>

                {loadingKnowledge ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)" }}>
                    Loading extracted knowledge & page citations...
                  </div>
                ) : knowledgeItems.length === 0 ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "8px" }}>
                    <Info size={24} style={{ marginBottom: "8px", opacity: 0.7 }} />
                    <p style={{ margin: 0 }}>No knowledge extracted yet. Upload a PDF or click Extract Knowledge above.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "380px", overflowY: "auto" }}>
                    {knowledgeItems.map((item) => {
                      const isSelected = selectedKnowledgeIds.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleKnowledgeSelect(item.id)}
                          style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: isSelected ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.02)",
                            border: isSelected ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid rgba(255, 255, 255, 0.06)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                            <div style={{ paddingTop: "2px", color: isSelected ? "#34d399" : "var(--color-text-muted)" }}>
                              {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                <span
                                  style={{
                                    textTransform: "uppercase",
                                    fontSize: "0.65rem",
                                    fontWeight: 700,
                                    letterSpacing: "0.05em",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background:
                                      item.knowledge_type === "statistic"
                                        ? "rgba(99, 102, 241, 0.2)"
                                        : item.knowledge_type === "claim"
                                        ? "rgba(245, 158, 11, 0.2)"
                                        : "rgba(16, 185, 129, 0.2)",
                                    color:
                                      item.knowledge_type === "statistic"
                                        ? "#a5b4fc"
                                        : item.knowledge_type === "claim"
                                        ? "#fbbf24"
                                        : "#34d399",
                                  }}
                                >
                                  {item.knowledge_type}
                                </span>
                                {item.page_start && (
                                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: "4px" }}>
                                    Page {item.page_start}{item.page_end && item.page_end !== item.page_start ? `–${item.page_end}` : ""}
                                  </span>
                                )}
                                {item.confidence && (
                                  <span style={{ fontSize: "0.75rem", color: "#34d399", marginLeft: "auto" }}>
                                    {Math.round(item.confidence * 100)}% confidence
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: "0 0 8px", fontSize: "0.9rem", fontWeight: 500, lineHeight: 1.4 }}>
                                {typeof item.value === "string" ? item.value : JSON.stringify(item.value)}
                              </p>
                              {item.source_excerpt && (
                                <blockquote
                                  style={{
                                    margin: 0,
                                    padding: "6px 10px",
                                    borderLeft: "2px solid rgba(255,255,255,0.2)",
                                    background: "rgba(0,0,0,0.2)",
                                    borderRadius: "0 4px 4px 0",
                                    fontSize: "0.8rem",
                                    fontStyle: "italic",
                                    color: "var(--color-text-muted)",
                                  }}
                                >
                                  "{item.source_excerpt}"
                                </blockquote>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Platform Selector & Action Bar */}
          <div className="panel" style={{ padding: "20px 24px" }}>
            <label style={{ fontWeight: "600", fontSize: "0.9rem", marginBottom: "10px", display: "block" }}>
              Target Social Platforms
            </label>
            <div className="platform-select" style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
              {platforms.map((p) => {
                const isSel = selectedPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className={isSel ? "selected" : ""}
                    onClick={() => togglePlatform(p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: isSel ? "1px solid #6366f1" : "1px solid rgba(255,255,255,0.1)",
                      background: isSel ? "rgba(99, 102, 241, 0.2)" : "rgba(255,255,255,0.03)",
                      color: isSel ? "#fff" : "var(--color-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    <PlatformIcon platform={p} />
                    {p}
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="error-box" role="alert" style={{ marginBottom: "16px", padding: "10px 14px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", color: "#f87171", fontSize: "0.85rem" }}>
                <AlertCircle size={15} style={{ display: "inline", marginRight: "6px" }} />
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <Button
                variant="primary"
                onClick={handleGeneratePosts}
                disabled={isGenerating || (activeTab === "pdf" && !selectedKnowledgeIds.length)}
                style={{ width: "100%", padding: "12px", fontSize: "0.95rem", fontWeight: 600 }}
              >
                <Sparkles size={18} />
                {isGenerating
                  ? "Generating Platform Posts..."
                  : activeTab === "pdf"
                  ? `Generate Single Post from Knowledge (${selectedKnowledgeIds.length} items)`
                  : "Generate Platform-Specific Posts"}
              </Button>

              {activeTab === "pdf" && selectedKnowledgeIds.length > 1 && (
                <Button
                  variant="secondary"
                  onClick={handleBatchGenerateFromKnowledge}
                  disabled={isGenerating}
                  style={{ width: "100%", padding: "10px", fontSize: "0.88rem", background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.35)", color: "#a5b4fc" }}
                >
                  <Layers size={16} />
                  Batch Generate Posts for Each Selected Knowledge ({selectedKnowledgeIds.length} Independent Posts)
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Preview & Variant Editing Column */}
        <aside className="preview-column" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="panel" style={{ padding: "20px", display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="preview-heading" style={{ marginBottom: "14px" }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Generated Post Variants</h2>
              <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Preview & refine copy for each platform</span>
            </div>

            {/* Platform Variant Tabs */}
            <div className="preview-tabs" style={{ display: "flex", gap: "6px", marginBottom: "16px", overflowX: "auto", paddingBottom: "4px" }}>
              {selectedPlatforms.map((p) => {
                const isActive = activePreviewPlatform === p;
                const hasVariant = !!generatedVariants[p];
                return (
                  <button
                    key={p}
                    type="button"
                    className={isActive ? "active" : ""}
                    onClick={() => setActivePreviewPlatform(p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "none",
                      background: isActive ? "#6366f1" : "rgba(255,255,255,0.05)",
                      color: isActive ? "#fff" : "var(--color-text-muted)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    <PlatformIcon platform={p} />
                    {p}
                    {hasVariant && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />}
                  </button>
                );
              })}
            </div>

            {/* Editor & Preview Area */}
            {Object.keys(generatedVariants).length === 0 ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "10px" }}>
                <Sparkles size={36} style={{ color: "#6366f1", marginBottom: "12px", opacity: 0.8 }} />
                <h3 style={{ margin: "0 0 6px", fontSize: "1rem", color: "#f1f5f9" }}>Ready for Generation</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", maxWidth: "280px" }}>
                  {activeTab === "pdf"
                    ? "Select extracted knowledge claims from your PDF and click Generate to produce channel-specific copy."
                    : "Fill in your topic prompt and click Generate to see live social post variants."}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
                {/* Variant Title */}
                <div>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "4px", display: "block" }}>
                    Internal Title
                  </label>
                  <input
                    type="text"
                    value={generatedTitle}
                    onChange={(e) => setGeneratedTitle(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", fontSize: "0.85rem" }}
                  />
                </div>

                {/* Editable Variant Body */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text-muted)" }}>
                      {activePreviewPlatform} Copy Variant
                    </label>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color:
                          (generatedVariants[activePreviewPlatform]?.length || 0) > platformLimits[activePreviewPlatform]
                            ? "#ef4444"
                            : "var(--color-text-muted)",
                      }}
                    >
                      {generatedVariants[activePreviewPlatform]?.length || 0} / {platformLimits[activePreviewPlatform]} chars
                    </span>
                  </div>
                  <textarea
                    rows={8}
                    value={generatedVariants[activePreviewPlatform] || ""}
                    onChange={(e) =>
                      setGeneratedVariants((prev) => ({
                        ...prev,
                        [activePreviewPlatform]: e.target.value,
                      }))
                    }
                    style={{ width: "100%", padding: "10px", fontSize: "0.85rem", lineHeight: 1.5 }}
                  />
                </div>

                {/* Simulated Social Card */}
                <div className="social-preview" style={{ background: "rgba(0, 0, 0, 0.3)", borderRadius: "10px", padding: "14px", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="social-profile" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                    <span className="workspace-avatar" style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.8rem" }}>
                      {s?.brand?.name?.[0] || "C"}
                    </span>
                    <div>
                      <strong style={{ fontSize: "0.85rem", display: "block" }}>{s?.brand?.name || s?.workspace?.name}</strong>
                      <small style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                        {activePreviewPlatform} • Just now
                      </small>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap", margin: "0 0 12px", lineHeight: 1.45 }}>
                    {generatedVariants[activePreviewPlatform] || "No content for this platform variant yet."}
                  </p>
                  <div className="social-reactions" style={{ display: "flex", gap: "16px", fontSize: "0.75rem", color: "var(--color-text-muted)", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><ThumbsUp size={13} /> Like</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><MessageSquare size={13} /> Comment</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Share2 size={13} /> Share</span>
                  </div>
                </div>

                {/* Save & Preview Actions */}
                <div style={{ marginTop: "auto", paddingTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <Button
                    variant="secondary"
                    onClick={() => setShowPreviewModal(true)}
                    disabled={!selectedPlatforms.length || !Object.keys(generatedVariants).length}
                    style={{ width: "100%", padding: "10px", fontSize: "0.9rem" }}
                  >
                    <Layers size={16} />
                    Publish Preview
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveToLibrary}
                    disabled={isSaving}
                    style={{ width: "100%", padding: "10px", fontSize: "0.9rem" }}
                  >
                    <Save size={16} />
                    {isSaving ? "Saving to Library..." : "Save Selected Posts to Content Library"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <PublishPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title={generatedTitle}
        body={Object.values(generatedVariants)[0] || ""}
        platforms={selectedPlatforms}
        variants={generatedVariants}
      />
    </div>
  );
}

import React, { useState, useEffect,useRef } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Wand2,
  ArrowUpRight,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge } from "../components/ui";
import { platforms, type Platform, type Snapshot } from "../lib/model";
import { data, request, documentsApi, type DocItem, type KnowledgeItem } from "../lib/api";
import { useSession } from "../lib/session";
import { PublishPreviewModal } from "../components/PublishPreviewModal";
import { ClipdropImageModal } from "../components/ClipdropImageModal";
import { BatchProgressIndicator } from "../components/BatchProgressIndicator";
import KnowledgeAutomation from './KnowledgeAutomation';
import { DocumentSourceMedia } from '../components/DocumentSourceMedia';
import './studio-integration.css';

function formatExcerpt(text: string | null | undefined): string {
  if (!text) return "";
  const clean = text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi, "")
    .replace(/\b[a-zA-Z0-9-]+\.(?:tk|com|net|org|in|io)\b/gi, "")
    .replace(/\[Page\s*\d+\]/gi, "")
    .replace(/[-_=|~]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(/\s+/).filter((w) => w.length >= 3 && /^[a-zA-Z0-9]+$/.test(w));
  if (words.length < 3) return "";

  return clean.length > 160 ? clean.substring(0, 160) + "..." : clean;
}
function visualEvidence(item:KnowledgeItem) {
  return item.metadata?.origin==='SOURCE_VISUAL'?{sourceMediaAssetId:item.metadata.sourceMediaAssetId,sourceReferenceId:item.metadata.sourceReferenceId,evidenceKind:item.metadata.evidenceKind,originalChecksum:item.metadata.originalChecksum}:{};
}

export default function AIStudio() {
  const s = useOutletContext<Snapshot>();
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showClipdropModal, setShowClipdropModal] = useState(false);
  const [showAutoPilotGuide, setShowAutoPilotGuide] = useState(false);
  const [attachedVisual, setAttachedVisual] = useState<{ assetId: string; url: string; filename: string } | null>(null);

  // Studio Mode: 'topic' | 'pdf'
  const [studioParams, setStudioParams] = useSearchParams();
  const activeTab = studioParams.get('tab') === 'automation' ? 'automation' : studioParams.get('tab') === 'pdf' ? 'pdf' : 'topic';
  const storedAutoPosts = useQuery({queryKey:["studio-autopilot-posts",s.workspace.id],queryFn:()=>request<{plans:any[]}>("/knowledge-automation"),enabled:!demo && activeTab === "pdf",refetchInterval:15000});
  const setActiveTab = (tab: 'topic' | 'pdf' | 'automation') => setStudioParams({tab});

  // Topic Mode state
  const [topic, setTopic] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(()=>{
    const connected = s.accounts.filter(a=>a.state.toLowerCase()==='connected').map(a=>platforms.find(p=>p.toLowerCase()===a.platform.toLowerCase())).filter((p):p is Platform=>!!p && p!=='YouTube');
    return connected.length ? [...new Set(connected)].slice(0,5) : ['LinkedIn','Instagram'];
  });
  const [tone, setTone] = useState(s?.brand?.tone || "Professional");
  const [goal, setGoal] = useState("Engagement");
  const [audience, setAudience] = useState("General Professional");

  // PDF Mode state
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const selectedDocRef=useRef(selectedDocId);selectedDocRef.current=selectedDocId;
  const [activeDoc, setActiveDoc] = useState<DocItem | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [extractingKnowledge, setExtractingKnowledge] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    currentName: string;
  } | null>(null);
  const [autopilotRunning, setAutopilotRunning] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [savedContentId, setSavedContentId] = useState<string | undefined>();
  const [generatedVariants, setGeneratedVariants] = useState<Partial<Record<Platform, string>>>({});
  const [activePreviewPlatform, setActivePreviewPlatform] = useState<Platform>("LinkedIn");
  const [posterScript, setPosterScript] = useState<{ prompt: string; headline: string } | null>(null);
  const [isGeneratingPosterScript, setIsGeneratingPosterScript] = useState(false);

  // Platform limits mapping
  const platformLimits: Record<Platform, number> = {
    LinkedIn: 3000,
    Instagram: 2200,
    Facebook: 63206,
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

  // Poll active document status if QUEUED, PROCESSING, EXTRACTING, CHUNKING
  useEffect(() => {
    if (!selectedDocId || activeTab !== "pdf") return;

    let timer: NodeJS.Timeout;
    let isCancelled = false;

    const checkDoc = async () => {
      try {
        const doc = await documentsApi.get(selectedDocId);
        if (isCancelled) return;

        setActiveDoc(doc);
        setDocuments((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, ...doc } : d))
        );

        if (doc.status === "READY") {
          // Load knowledge automatically when document is ready
          fetchKnowledge(selectedDocId);
        } else if (doc.status !== "FAILED") {
          // Stream knowledge items in real time as they arrive
          fetchKnowledge(selectedDocId, 0, true);
          // Keep polling while QUEUED, PROCESSING, EXTRACTING, CHUNKING
          timer = setTimeout(checkDoc, 1500);
        }
      } catch (err: any) {
        if (err?.message?.includes("404") || err?.status === 404) {
          setSelectedDocId(null);
          setActiveDoc(null);
          return;
        }
        console.error("Doc status check error:", err);
      }
    };

    checkDoc();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
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

  async function fetchKnowledge(docId: string, retryCount = 0, silent = false) {
    try {
      if (!silent && retryCount === 0 && knowledgeItems.length === 0) setLoadingKnowledge(true);
      const items = await documentsApi.listKnowledge(docId);
      if (items.length > 0) {
        setKnowledgeItems(items);
        setSelectedKnowledgeIds((prev) => {
          const newIds = items.map((k) => k.id);
          return Array.from(new Set([...prev, ...newIds]));
        });
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
        void triggerFastPosterScript(items, activeDoc?.original_filename);
        return;
      }

      // If document is READY but worker auto-extraction is still finishing in the background
      if (items.length === 0 && !silent && retryCount < 12) {
        setTimeout(() => {
          fetchKnowledge(docId, retryCount + 1, false);
        }, 1500);
      } else if (!silent) {
        setKnowledgeItems([]);
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
      }
    } catch (err) {
      console.error("Error fetching knowledge:", err);
      if (!silent) {
        setLoadingKnowledge(false);
        setExtractingKnowledge(false);
      }
    }
  }

  async function triggerFastPosterScript(items: Array<{ id: string; knowledge_key?: string; value: any; source_excerpt?: string }>, docName?: string) {
    if (!items || !items.length) return;
    try {
      setIsGeneratingPosterScript(true);
      const topItem = items[0];
      const concept = typeof topItem.value === "string" ? topItem.value : JSON.stringify(topItem.value);
      const excerpt = topItem.source_excerpt || "";
      const title = topItem.knowledge_key || docName || "SaaS Insights";

      const res = await request<{ prompt: string; headline: string }>("/clipdrop/suggest-poster-prompt", "POST", {
        knowledgeConcept: concept,
        excerpt,
        sourceVisualContext: `Extracted from PDF ${docName || "document"}`,
        title,
        platform: activePreviewPlatform || "Instagram",
      });

      if (res?.prompt) {
        setPosterScript(res);
        setGeneratedTitle(res.headline || title);

        const defaultPlatforms: Platform[] = ["LinkedIn", "Instagram", "Facebook", "Telegram"];
        const newVariants: Partial<Record<Platform, string>> = {};
        const hashtags = ["#SaaS", "#Growth", "#Innovation", "#TechTrends"];
        for (const p of defaultPlatforms) {
          if (p === "LinkedIn") {
            newVariants[p] = `🚀 ${res.headline || title}\n\n${concept}\n\n"${excerpt.slice(0, 220)}"\n\nKey takeaways from our latest technical breakdown.\n\n${hashtags.join(" ")}`;
          } else if (p === "Instagram") {
            newVariants[p] = `✨ ${res.headline || title}\n\nSwipe to see how ${concept.slice(0, 100)} transforms operations.\n\n${hashtags.join(" ")}`;
          } else if (p === "Telegram") {
            newVariants[p] = `⚡️ *${res.headline || title}*\n\n${concept}\n\n${excerpt.slice(0, 180)}\n\n${hashtags.join(" ")}`;
          } else {
            newVariants[p] = `${res.headline || title}: ${concept}\n\n${hashtags.join(" ")}`;
          }
        }
        setGeneratedVariants((prev) => ({ ...newVariants, ...prev }));
        toast.success("⚡ AI Poster Script & Multi-Platform Copy generated instantly!");
      }
    } catch (err) {
      console.warn("Fast poster script generation notice:", err);
    } finally {
      setIsGeneratingPosterScript(false);
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
    const rawFiles = Array.from(e.target.files || []);
    if (!rawFiles.length) return;
    const files = rawFiles.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!files.length) {
      toast.error("Please select valid PDF files.");
      return;
    }

    try {
      setUploadingPdf(true);
      setError(null);

      if (files.length === 1) {
        const file = files[0];
        const res = await documentsApi.uploadPdf(file);
        toast.success(`PDF uploaded: ${file.name}`);
        setSelectedDocId(res.documentId);
        await fetchDocuments();
        if (res.status === "READY") {
          await fetchKnowledge(res.documentId);
        }
      } else {
        // High-speed parallel batch upload
        setBatchProgress({
          total: files.length,
          completed: 0,
          currentName: files[0].name,
        });
        const uploaded = await documentsApi.uploadBatchPdfs(
          files,
          (completed, total, currentName) => {
            setBatchProgress({ total, completed, currentName });
          },
        );
        toast.success(
          `Batch upload completed: ${uploaded.length} of ${files.length} PDFs uploaded successfully!`,
        );
        if (uploaded.length > 0) {
          setSelectedDocId(uploaded[0].documentId);
        }
        await fetchDocuments();
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploadingPdf(false);
      setBatchProgress(null);
      e.target.value = "";
    }
  }

  async function handleFastTrack(docId: string) {
    try {
      toast.info("Fast-tracking extraction & knowledge analysis...");
      const res = await documentsApi.fastTrack(docId);
      setActiveDoc((prev) =>
        prev
          ? {
              ...prev,
              status: "READY",
              page_count: res.pageCount ?? prev.page_count,
            }
          : null,
      );
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, status: "READY", page_count: res.pageCount ?? d.page_count }
            : d,
        ),
      );
      await fetchKnowledge(docId);
      toast.success("PDF processing & knowledge extraction complete!");
    } catch (err: any) {
      toast.error(err.message || "Failed to fast-track PDF");
    }
  }

  async function handleTriggerKnowledgeExtract() {
    if (!selectedDocId) return;
    try {
      setExtractingKnowledge(true);
      setLoadingKnowledge(true);
      setError(null);
      const res = await documentsApi.extractKnowledge(selectedDocId);
      if (res.status === "PROCESSING" || res.status === "EXTRACTING" || res.status === "CHUNKING") {
        toast.info("Document is currently extracting text. Knowledge will be extracted as soon as it's ready.");
      } else {
        toast.success("Extracting key insights & claims from document...");
      }
      // Poll knowledge items
      setTimeout(() => {
        fetchKnowledge(selectedDocId, 0);
      }, 1500);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
      setExtractingKnowledge(false);
      setLoadingKnowledge(false);
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

  async function handleTriggerAutoPilot() {
    if (!selectedDocId) {
      toast.error("Please select a PDF document first.");
      return;
    }
    setAutopilotRunning(true);
    try {
      const res = await request<{ success: boolean; generated: number; message: string }>(
        "/knowledge-automation/auto-pilot",
        "POST",
        { documentId: selectedDocId }
      );
      toast.success(res.message || "⚡ Auto-Pilot executed successfully!");
      await Promise.all([
        query.invalidateQueries({ queryKey: ["documents"] }),
        query.invalidateQueries({ queryKey: ["posts"] }),
        query.invalidateQueries({ queryKey: ["calendar"] }),
        query.invalidateQueries({ queryKey: ["knowledge-automation"] }),
        query.invalidateQueries({ queryKey: ["workspace"] }),
      ]);
    } catch (err: any) {
      toast.error(err.message || "Auto-Pilot failed to start.");
    } finally {
      setAutopilotRunning(false);
    }
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
              `Point ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}\nSource page: ${k.page_start || 'unavailable'}${k.page_end && k.page_end!==k.page_start ? `–${k.page_end}` : ''}\nSource excerpt: ${k.source_excerpt || 'unavailable'}`
          )
          .join("\n\n");
        promptTopic = `Generate social media posts based on the following verified PDF knowledge:\n\nDocument: ${
          activeDoc?.original_filename || "Attached PDF"
        }\nTarget Audience: ${audience}\n\nKey Knowledge & Insights:\n${knowledgeSummary}`;
        if (promptTopic.length > 4000) {
          promptTopic = promptTopic.slice(0, 4000);
        }
      } else {
        if (promptTopic.length < 5) {
          throw new Error("Please provide a topic or prompt of at least 5 characters.");
        }
      }
      promptTopic = `${promptTopic}\nTarget audience: ${audience}`;

      setIsGenerating(true);
      setSavedContentId(undefined);
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
      if (!(await handleSaveToLibrary(result, false))) throw new Error('Content was generated but could not be saved for review. Retry saving below.');
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
        topic: `Knowledge Item ${idx + 1} (${k.knowledge_type}): ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}\nSource page: ${k.page_start || 'unavailable'}\nExcerpt: ${k.source_excerpt || 'unavailable'}\nAudience: ${audience}`.slice(0, 2000),
        tone,
        goal,
        platforms: selectedPlatforms,
        sourceEvidence:[{documentId:selectedDocId,documentName:activeDoc?.original_filename,knowledgeId:k.id,pageStart:k.page_start,pageEnd:k.page_end,excerpt:k.source_excerpt,...visualEvidence(k)}],
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

  async function handleSaveToLibrary(generation?: {title:string;variants:Partial<Record<Platform,string>>}, navigate = true, visual = attachedVisual) {
    try {
      setError(null);
      let visualToUse = visual;
      if (!visualToUse && activeTab === 'pdf' && selectedDocId) {
        try {
          const media = await request<any>(`/documents/${selectedDocId}/source-media`);
          if (media.assets && media.assets.length > 0) {
            const selectedItems = knowledgeItems.filter(k => selectedKnowledgeIds.includes(k.id));
            const targetPage = selectedItems.find(k => k.page_start)?.page_start;
            const matchedAsset = (targetPage ? media.assets.find((a: any) => a.pageNumber === targetPage) : null) || media.assets[0];
            if (matchedAsset) {
              visualToUse = {
                assetId: matchedAsset.assetId,
                url: matchedAsset.url,
                filename: `PDF page ${matchedAsset.pageNumber} visual`,
              };
              setAttachedVisual(visualToUse);
            }
          }
        } catch (e) {
          console.warn("Could not auto-pair PDF visual:", e);
        }
      }
      const titleToSave = generation?.title || generatedTitle;
      const variantsToSave = generation?.variants || generatedVariants;
      if (!titleToSave.trim() || !Object.keys(variantsToSave).length) {
        throw new Error("No generated content available to save.");
      }

      setIsSaving(true);
      const firstPlatform = selectedPlatforms[0] || "LinkedIn";
      const baseBody = variantsToSave[firstPlatform] || Object.values(variantsToSave)[0] || "";

      // Attach visual media asset to variants if generated
      const finalVariants: Record<string, any> = {};
      const sourceEvidence = generation ? (activeTab === 'pdf' ? knowledgeItems.filter(k=>selectedKnowledgeIds.includes(k.id)).map(k=>({documentId:selectedDocId,documentName:activeDoc?.original_filename,knowledgeId:k.id,pageStart:k.page_start,pageEnd:k.page_end,excerpt:k.source_excerpt,...visualEvidence(k)})) : []) : generatedEvidence;
      if (generation) setGeneratedEvidence(sourceEvidence);
      for (const [p, val] of Object.entries(variantsToSave)) {
        if (visualToUse) {
          finalVariants[p] = {
            caption: typeof val === "string" ? val : (val as any)?.caption || "",
            mediaAssetId: visualToUse.assetId,
            mediaUrl: visualToUse.url,
            mediaType: "image",
            metadata: {sourceEvidence},
          };
        } else {
          finalVariants[p] = {caption:val,metadata:{sourceEvidence}};
        }
      }

      const saved = await data.save({
        id: generation ? undefined : savedContentId,
        title: titleToSave,
        body: baseBody,
        platforms: selectedPlatforms,
        variants: finalVariants,
      });
      setSavedContentId(saved.id);
      await data.transition(saved.id,'review');

      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Platform-specific posts saved to Content Library · Needs Review");
      if (navigate) nav("/app/library");
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
      return false;
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
            toast.success("Batch generation finished. Check Content Library → Needs Review.");
          }}
        />
      )}

            <div className="page-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span
              className="badge"
              style={{
                background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(16, 185, 129, 0.2))",
                color: "var(--accent)",
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
            AI Studio
          </h1>
          <p style={{ color: "var(--color-text-muted, var(--muted))", margin: 0 }}>
            Add your business knowledge, create content, and keep your calendar active. Every generated post goes to your approval queue.
          </p>
        </div>
      </div>

      {/* Mode Selector Tabs */}
      {/* Mode Selector Tabs */}
      <div
        className="studio-tabs"
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "20px",
          background: "var(--surface2)",
          padding: "5px",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          width: "fit-content",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("topic")}
          className={activeTab === 'topic' ? 'active' : ''}
          aria-pressed={activeTab === 'topic'}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "topic" ? "var(--color-accent, #6366f1)" : "transparent",
            color: activeTab === "topic" ? "#fff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: 600,
            fontSize: "0.88rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <FileText size={16} />
          Create content
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("pdf")}
          className={activeTab === 'pdf' ? 'active' : ''}
          aria-pressed={activeTab === 'pdf'}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "pdf" ? "var(--color-accent, #6366f1)" : "transparent",
            color: activeTab === "pdf" ? "#fff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: 600,
            fontSize: "0.88rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <BookOpen size={16} />
          Business knowledge
          <span
            style={{
              background: activeTab === "pdf" ? "rgba(255, 255, 255, 0.25)" : "rgba(16, 185, 129, 0.15)",
              color: activeTab === "pdf" ? "#fff" : "var(--success, #10b981)",
              fontSize: "0.68rem",
              padding: "2px 7px",
              borderRadius: "10px",
              fontWeight: 700,
            }}
          >
            PDFs
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("automation")}
          className={activeTab === 'automation' ? 'active' : ''}
          aria-pressed={activeTab === 'automation'}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            background: activeTab === "automation" ? "var(--color-accent, #6366f1)" : "transparent",
            color: activeTab === "automation" ? "#fff" : "var(--color-text-muted, #94a3b8)",
            fontWeight: 600,
            fontSize: "0.88rem",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <Clock size={16} />
          Automate content
          <span
            style={{
              background: activeTab === "automation" ? "rgba(255, 255, 255, 0.25)" : "rgba(99, 102, 241, 0.15)",
              color: activeTab === "automation" ? "#fff" : "var(--accent, #6366f1)",
              fontSize: "0.68rem",
              padding: "2px 7px",
              borderRadius: "10px",
              fontWeight: 700,
            }}
          >
            Auto
          </span>
        </button>
      </div>

      <div className="studio-workflow-strip">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "0.82rem", color: "var(--color-text-muted, #94a3b8)" }}>
          <span>Business knowledge</span>
          <ChevronRight size={13} style={{ opacity: 0.5 }} />
          <span>AI Content</span>
          <ChevronRight size={13} style={{ opacity: 0.5 }} />
          <span>Approval Queue</span>
          <ChevronRight size={13} style={{ opacity: 0.5 }} />
          <span style={{ color: "var(--accent, #6366f1)", fontWeight: 600 }}>Scheduled Publishing</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link to="/app/approvals" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text-muted, #94a3b8)", textDecoration: "none" }}>
            Approvals <ArrowUpRight size={13} />
          </Link>
          <Link to="/app/calendar" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text-muted, #94a3b8)", textDecoration: "none" }}>
            Calendar <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
      {activeTab === 'automation' && <KnowledgeAutomation embedded />}
      <div className="composer-grid studio-creation-grid" style={{ display: activeTab === 'automation' ? 'none' : "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 420px)", gap: "24px" }}>
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
                      <BookOpen size={18} style={{ color: "var(--success)" }} />
                Your business knowledge
                    </h2>
                    <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                      Upload whitepapers, research reports, or specs to extract verifiable claims and insights.
                    </p>
                  </div>
                </div>

                {/* Upload Dropzone */}
                <div
                  style={{
                    border: "2px dashed var(--border)",
                    borderRadius: "12px",
                    padding: "24px",
                    textAlign: "center",
                    background: "var(--surface2)",
                    marginBottom: "20px",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Upload size={32} style={{ color: "#6366f1", marginBottom: "10px" }} />
                  <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Upload PDF Document(s)</h4>
                  <p style={{ margin: "0 0 14px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    Supports batch uploading multiple PDFs up to 50MB each. Fast parallel extraction with AI evidence.
                  </p>
                  
                  {batchProgress && (
                    <div style={{ margin: "0 auto 14px", maxWidth: "320px", background: "var(--border)", borderRadius: "8px", padding: "10px", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "6px" }}>
                        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Batch Processing: {batchProgress.completed}/{batchProgress.total}</span>
                        <span style={{ color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px", whiteSpace: "nowrap" }}>
                          {batchProgress.currentName}
                        </span>
                      </div>
                      <div style={{ height: "4px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${(batchProgress.completed / batchProgress.total) * 100}%`,
                            background: "linear-gradient(90deg, #6366f1, #10b981)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <label className="button primary" style={{ cursor: uploadingPdf ? "wait" : "pointer", display: "inline-flex", gap: "8px" }}>
                    <Upload size={15} />
                    {uploadingPdf
                      ? (batchProgress ? `Uploading (${batchProgress.completed}/${batchProgress.total})...` : "Uploading & Initializing...")
                      : "Select PDF File(s)"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,application/pdf"
                      style={{ display: "none" }}
                      disabled={uploadingPdf}
                      onChange={handleFileUpload}
                    />
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
                            setPosterScript(null);
                            if (doc.status === "READY") fetchKnowledge(doc.id);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            background: selectedDocId === doc.id ? "rgba(99, 102, 241, 0.15)" : "var(--surface2)",
                            border: selectedDocId === doc.id ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid var(--border)",
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
                            {Boolean(doc.page_count && doc.page_count > 0) && (
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
                                color: "var(--danger)",
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

                {/* 100% Zero-Touch Auto-Pilot Mode Banner */}
                {selectedDocId && (
                  <div
                    style={{
                      margin: "16px 0",
                      padding: "16px 20px",
                      borderRadius: "12px",
                      background: "linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)",
                      border: "1px solid rgba(129, 140, 248, 0.4)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "16px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <Sparkles size={18} color="#818cf8" />
                        <strong style={{ fontSize: "1rem", color: "#f8fafc" }}>100% Zero-Touch Auto-Pilot</strong>
                        <span style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: "10px", background: "#4f46e5", color: "#fff", fontWeight: 700 }}>
                          HANDS-FREE
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                        Auto-pairs PDF visuals, creates multi-platform captions & hashtags, schedules posts day-by-day (10:00 AM), and auto-injects festival greetings (Diwali, Holi, Eid, Independence Day).
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Button
                        variant="secondary"
                        onClick={() => setShowAutoPilotGuide(true)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(255, 255, 255, 0.08)",
                          border: "1px solid rgba(255, 255, 255, 0.2)",
                          color: "#e2e8f0",
                          padding: "9px 14px",
                          fontSize: "0.85rem",
                        }}
                      >
                        <BookOpen size={15} /> How It Works
                      </Button>
                      <Button
                        variant="primary"
                        disabled={autopilotRunning}
                        onClick={handleTriggerAutoPilot}
                        style={{
                          background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                          fontWeight: 700,
                          padding: "9px 18px",
                          fontSize: "0.9rem",
                          border: "none",
                          boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
                        }}
                      >
                        {autopilotRunning ? "⚡ Running Auto-Pilot…" : "⚡ Start Auto-Pilot"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Smooth In-App Auto-Pilot Guide Modal */}
                {showAutoPilotGuide && (
                  <div
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: "rgba(0, 0, 0, 0.8)",
                      backdropFilter: "blur(6px)",
                      zIndex: 9999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "20px",
                    }}
                    onClick={() => setShowAutoPilotGuide(false)}
                  >
                    <div
                      style={{
                        background: "#13132b",
                        border: "1px solid rgba(129, 140, 248, 0.4)",
                        borderRadius: "16px",
                        maxWidth: "600px",
                        width: "100%",
                        padding: "28px",
                        boxShadow: "0 24px 48px rgba(0, 0, 0, 0.6)",
                        color: "#f8fafc",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Sparkles size={24} color="#818cf8" />
                          <h2 style={{ fontSize: "1.2rem", margin: 0, fontWeight: 700 }}>How PDF Post Automation Works</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAutoPilotGuide(false)}
                          style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "1.5rem", cursor: "pointer", lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", background: "rgba(255,255,255,0.04)", padding: "14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.85rem", flexShrink: 0 }}>1</div>
                          <div>
                            <strong style={{ display: "block", fontSize: "0.92rem", color: "#fff" }}>Upload Your Business PDF</strong>
                            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.45 }}>
                              Upload any brochure, research report, or product catalog. The engine extracts text insights and image previews.
                            </p>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", background: "rgba(255,255,255,0.04)", padding: "14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#a855f7", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.85rem", flexShrink: 0 }}>2</div>
                          <div>
                            <strong style={{ display: "block", fontSize: "0.92rem", color: "#fff" }}>Click "⚡ Start Auto-Pilot"</strong>
                            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.45 }}>
                              Zero manual work: AI auto-pairs PDF visuals, creates platform-specific copy & hashtags, and assigns posts day-by-day (Day 1, Day 2...).
                            </p>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", background: "rgba(255,255,255,0.04)", padding: "14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "0.85rem", flexShrink: 0 }}>3</div>
                          <div>
                            <strong style={{ display: "block", fontSize: "0.92rem", color: "#fff" }}>Autonomous Publishing & Dual Alerts</strong>
                            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.45 }}>
                              Posts go live automatically at designated slot times. You receive real-time notifications inside ContentOS and directly in your registered Gmail.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                        <Button variant="primary" onClick={() => setShowAutoPilotGuide(false)}>
                          Got it, Let's Automate!
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Active Document Status & Knowledge Extract Action */}
                {selectedDocId && activeDoc && <DocumentSourceMedia key={selectedDocId} documentId={selectedDocId} documentStatus={activeDoc.status} canExtract={['Owner','Admin','Content Manager','Editor'].includes(s.workspace.role)} selectedAssetId={attachedVisual?.assetId} onKnowledgeChanged={id=>{if(selectedDocRef.current===id)void fetchKnowledge(id);}} onSelectVisual={visual => setAttachedVisual(visual)} />}
                {activeDoc && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "14px",
                      borderRadius: "8px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
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
                      {activeDoc.status === "READY" || activeDoc.status === "FAILED" ? (
                        <Button
                          onClick={handleTriggerKnowledgeExtract}
                          disabled={extractingKnowledge || loadingKnowledge}
                          style={{
                            fontSize: "0.85rem",
                            padding: "6px 14px",
                            background: activeDoc.status === "FAILED" ? "rgba(239, 68, 68, 0.2)" : undefined,
                            border: activeDoc.status === "FAILED" ? "1px solid rgba(239, 68, 68, 0.4)" : undefined,
                            color: activeDoc.status === "FAILED" ? "#fca5a5" : undefined,
                          }}
                        >
                          <RotateCw size={14} className={extractingKnowledge ? "animate-spin" : ""} />
                          {extractingKnowledge ? "Extracting..." : activeDoc.status === "FAILED" ? "Retry Extraction" : "Re-extract Knowledge"}
                        </Button>
                      ) : (
                        <>
                          <span style={{ fontSize: "0.8rem", color: "var(--warning)", display: "flex", alignItems: "center", gap: "6px" }}>
                            <Clock size={14} className="animate-spin" /> Processing PDF...
                          </span>
                          <Button
                            variant="secondary"
                            onClick={() => handleFastTrack(activeDoc.id)}
                            style={{ fontSize: "0.8rem", padding: "4px 10px", border: "1px solid rgba(16, 185, 129, 0.4)", color: "var(--success)", background: "rgba(16, 185, 129, 0.1)" }}
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
                          color: "var(--danger)",
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

              {/* Fast AI Poster Script Card Generated from PDF */}
              {(posterScript || isGeneratingPosterScript) && (
                <div
                  style={{
                    marginBottom: "20px",
                    padding: "18px 22px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%)",
                    border: "1px solid rgba(129, 140, 248, 0.4)",
                    boxShadow: "0 8px 30px rgba(99, 102, 241, 0.15)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", flexWrap: "wrap", marginBottom: "12px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <Sparkles size={18} style={{ color: "#818cf8" }} />
                        <strong style={{ fontSize: "1.05rem", color: "#f8fafc" }}>
                          AI Poster Script &amp; Visual Prompt (Generated from PDF)
                        </strong>
                        {isGeneratingPosterScript ? (
                          <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "10px", background: "rgba(99, 102, 241, 0.3)", color: "#a5b4fc", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                            <RotateCw size={12} className="animate-spin" /> Generating Fast...
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "10px", background: "rgba(16, 185, 129, 0.2)", color: "#34d399", fontWeight: 700 }}>
                            READY TO RENDER
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                        Automatically crafted high-converting 3D SaaS visual prompt based on PDF insights &amp; diagrams.
                      </p>
                    </div>

                    {posterScript && (
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <Button
                          type="button"
                          onClick={() => setShowClipdropModal(true)}
                          style={{
                            padding: "8px 16px",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                            border: "none",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "0 4px 14px rgba(236, 72, 153, 0.4)",
                          }}
                        >
                          <Wand2 size={15} /> Render Poster with AI
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => triggerFastPosterScript(knowledgeItems, activeDoc?.original_filename)}
                          disabled={isGeneratingPosterScript}
                          style={{ fontSize: "0.85rem", padding: "8px 12px" }}
                        >
                          <RotateCw size={14} className={isGeneratingPosterScript ? "animate-spin" : ""} /> Regenerate
                        </Button>
                      </div>
                    )}
                  </div>

                  {posterScript && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "14px", marginTop: "12px", background: "rgba(0, 0, 0, 0.25)", padding: "14px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                      <div>
                        <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#818cf8", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                          Catchy Poster Headline
                        </span>
                        <strong style={{ fontSize: "1rem", color: "#fff", lineHeight: 1.3, display: "block" }}>
                          {posterScript.headline}
                        </strong>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#a855f7", fontWeight: 700, display: "block", marginBottom: "4px" }}>
                          3D SaaS Visual Prompt (Clipdrop / FLUX)
                        </span>
                        <p style={{ margin: 0, fontSize: "0.83rem", color: "#e2e8f0", lineHeight: 1.45, fontStyle: "italic" }}>
                          &ldquo;{posterScript.prompt}&rdquo;
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Extracted Knowledge & Evidence Panel */}
              <div className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                      <Quote size={18} style={{ color: "var(--success)" }} />
                      Extracted Knowledge & Evidence ({knowledgeItems.length})
                      {(activeDoc?.status === "EXTRACTING" || activeDoc?.status === "PROCESSING" || activeDoc?.status === "CHUNKING" || extractingKnowledge) && (
                        <span style={{ fontSize: "0.75rem", padding: "3px 9px", borderRadius: "12px", background: "rgba(16, 185, 129, 0.15)", color: "var(--success)", border: "1px solid rgba(16, 185, 129, 0.3)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", display: "inline-block", boxShadow: "0 0 8px #10b981" }} />
                          Live Streaming Facts...
                        </span>
                      )}
                    </h3>
                    <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                      Select the verified claims, statistics, or summaries to feed into your social post generator.
                    </p>
                  </div>
                  {knowledgeItems.length > 0 && (
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: "0.8rem", color: "var(--danger)" }}
                        onClick={async () => {
                          if (!selectedDocId) return;
                          try {
                            await documentsApi.clearAllKnowledge(selectedDocId);
                            setKnowledgeItems([]);
                            setSelectedKnowledgeIds([]);
                            toast.success("All knowledge claims cleared.");
                          } catch {
                            toast.error("Failed to clear knowledge claims");
                          }
                        }}
                      >
                        Clear All
                      </button>
                    </div>
                  )}
                </div>

                {loadingKnowledge && knowledgeItems.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-muted)" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <RotateCw size={18} className="animate-spin" style={{ color: "var(--success)" }} />
                      <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Extracting knowledge & claims in real-time...</span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                      Facts and verified citations stream in below as AI processes document chunks.
                    </p>
                  </div>
                ) : knowledgeItems.length === 0 ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--color-text-muted)", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                    <Info size={24} style={{ marginBottom: "8px", opacity: 0.7 }} />
                    <p style={{ margin: 0 }}>
                      {activeDoc?.status === "FAILED"
                        ? "Extraction encountered an issue. Click 'Retry Extraction' above to retry instantly."
                        : (activeDoc?.status === "EXTRACTING" || activeDoc?.status === "PROCESSING")
                          ? "Reading PDF pages and extracting claims in real time... Claims will pop up here shortly."
                          : "No knowledge extracted yet. Upload a PDF or click Re-extract Knowledge above."}
                    </p>
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
                            background: isSelected ? "rgba(16, 185, 129, 0.08)" : "var(--surface2)",
                            border: isSelected ? "1px solid rgba(16, 185, 129, 0.35)" : "1px solid var(--border)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                            <div style={{ paddingTop: "2px", color: isSelected ? "var(--success)" : "var(--color-text-muted)" }}>
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
                                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", background: "var(--border)", padding: "1px 6px", borderRadius: "4px" }}>
                                    Page {item.page_start}{item.page_end && item.page_end !== item.page_start ? `–${item.page_end}` : ""}
                                  </span>
                                )}
                                {item.confidence && (
                                  <span style={{ fontSize: "0.75rem", color: "var(--success)", marginLeft: "auto" }}>
                                    {Math.round(item.confidence * 100)}% confidence
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", margin: "0 0 6px" }}>
                                <strong style={{ fontSize: "0.95rem", color: "var(--accent)", display: "block", marginBottom: "4px" }}>
                                  {item.knowledge_key}
                                </strong>
                                <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 400, lineHeight: 1.5, color: "var(--ink)" }}>
                                  {typeof item.value === "string" ? item.value : JSON.stringify(item.value)}
                                </p>
                                <button
                                  type="button"
                                  title="Remove this extracted claim"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!selectedDocId) return;
                                    try {
                                      await documentsApi.deleteKnowledge(selectedDocId, item.id);
                                      setKnowledgeItems((prev) => prev.filter((k) => k.id !== item.id));
                                      setSelectedKnowledgeIds((prev) => prev.filter((id) => id !== item.id));
                                      toast.success("Claim removed.");
                                    } catch {
                                      toast.error("Failed to remove claim");
                                    }
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--color-text-muted)",
                                    cursor: "pointer",
                                    padding: "2px 4px",
                                    borderRadius: "4px",
                                    flexShrink: 0,
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                              {item.source_excerpt && formatExcerpt(item.source_excerpt) && (
                                <blockquote
                                  style={{
                                    margin: 0,
                                    padding: "6px 10px",
                                    borderLeft: "2px solid var(--border-strong)",
                                    background: "var(--surface2)",
                                    borderRadius: "0 4px 4px 0",
                                    fontSize: "0.8rem",
                                    fontStyle: "italic",
                                    color: "var(--color-text-muted)",
                                    lineHeight: 1.4,
                                  }}
                                >
                                  "{formatExcerpt(item.source_excerpt)}"
                                </blockquote>
                              )}
                              <div className="studio-fact-approval">
                                {item.metadata?.origin==='SOURCE_VISUAL'&&<p style={{fontSize:12,color:'var(--muted)'}}>{item.metadata.evidenceKind==='OCR_TEXT'?'OCR text from source image':'AI visual interpretation · verify against the source image'}</p>}
                                <span>{['CONFIRMED','LOCKED'].includes(item.status) ? 'Approved for automatic content' : 'Approve this fact to use it in automatic content'}</span>
                                {!demo && ['Owner','Admin','Content Manager','Editor'].includes(s.workspace.role) && !['CONFIRMED','LOCKED'].includes(item.status) && <Button disabled={!item.source_excerpt?.trim()} onClick={async(e)=>{e.stopPropagation();if(!selectedDocId)return;try{await request(`/documents/${selectedDocId}/knowledge/${item.id}`,'PATCH',{status:'CONFIRMED'});await fetchKnowledge(selectedDocId);await query.invalidateQueries({queryKey:['knowledge-automation']});toast.success('Fact approved. Automation can now use it.');}catch(error:any){toast.error(error.message || 'Could not approve fact.');}}}>Approve fact</Button>}
                              </div>
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
                      border: isSel ? "1px solid #6366f1" : "1px solid var(--border)",
                      background: isSel ? "rgba(99, 102, 241, 0.2)" : "var(--surface2)",
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
              <div className="error-box" role="alert" style={{ marginBottom: "16px", padding: "10px 14px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", color: "var(--danger)", fontSize: "0.85rem" }}>
                <AlertCircle size={15} style={{ display: "inline", marginRight: "6px" }} />
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "10px" }}>
                <Button
                  variant="primary"
                  onClick={handleGeneratePosts}
                  disabled={isGenerating || (activeTab === "pdf" && !selectedKnowledgeIds.length)}
                  style={{ width: "100%", padding: "12px", fontSize: "0.92rem", fontWeight: 700 }}
                >
                  <Sparkles size={17} />
                  {isGenerating
                    ? "Generating Platform Posts..."
                    : activeTab === "pdf"
                    ? `Generate Post (${selectedKnowledgeIds.length} items)`
                    : "Generate Social Posts"}
                </Button>

                <Button
                  type="button"
                  onClick={() => setShowClipdropModal(true)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                    border: "none",
                    color: "var(--ink)",
                    boxShadow: "0 4px 15px rgba(236, 72, 153, 0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <Wand2 size={17} />
                  🎨 Generate Visual / Image
                </Button>
              </div>

              {activeTab === "pdf" && selectedKnowledgeIds.length > 1 && (
                <Button
                  variant="secondary"
                  onClick={handleBatchGenerateFromKnowledge}
                  disabled={isGenerating}
                  style={{ width: "100%", padding: "10px", fontSize: "0.88rem", background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.35)", color: "var(--accent)" }}
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
            {activeTab === "pdf" && <details className="studio-stored-posts" open>
              <summary>Stored Auto-pilot posts ({storedAutoPosts.data?.plans.filter(post=>post.content_id).length || 0})</summary>
              <p>Generated posts stay saved here and in Content library. Scheduled does not mean published.</p>
              {storedAutoPosts.isError ? <p role="alert">Unable to load stored posts. Refresh to retry.</p> : storedAutoPosts.data?.plans.filter(post=>post.content_id).length ? <div style={{maxHeight:260,overflowY:"auto"}}>{storedAutoPosts.data.plans.filter(post=>post.content_id).map(post=><button type="button" key={post.id} onClick={()=>{
                const targets=(post.platforms || []).filter((platform:string)=>["LinkedIn","Instagram","Facebook","Telegram","X","YouTube"].includes(platform)) as Platform[];
                setGeneratedTitle(post.title || "Saved post");setSelectedPlatforms(targets);setActivePreviewPlatform(targets[0] || "LinkedIn");
                setGeneratedVariants(Object.fromEntries(targets.map(platform=>[platform,typeof post.variants?.[platform] === "string" ? post.variants[platform] : post.variants?.[platform]?.caption || ""])));
                const visual=targets.map(platform=>post.variants?.[platform]).find(variant=>variant?.mediaAssetId && variant?.mediaUrl);
                setAttachedVisual(visual ? {assetId:visual.mediaAssetId,url:visual.mediaUrl,filename:"Saved autopilot visual"} : null);
              }}><strong>{post.title}</strong><small>{post.content_status} · {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "Not scheduled"}</small></button>)}</div> : <p>No Auto-pilot posts stored yet. Generation history will show why work is pending or failed.</p>}
              <Link to="/app/library">Open all stored posts →</Link>
            </details>}

            {/* Platform Variant Tabs */}
            <div className="preview-tabs" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px", paddingBottom: "4px" }}>
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
                      background: isActive ? "#6366f1" : "var(--surface2)",
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
            {Object.keys(generatedVariants).length > 0 && <details style={{marginBottom:16}}>
              <summary>Why did AI write this?</summary>
              <p>These inputs were supplied to AI. Review the source before approving any claims.</p>
              {generatedEvidence.length ? generatedEvidence.map(e=><div key={e.knowledgeId}><strong>{e.documentName} · {e.pageStart ? `Page ${e.pageStart}${e.pageEnd && e.pageEnd!==e.pageStart ? `–${e.pageEnd}` : ''}` : 'Page unavailable'}</strong><blockquote>{e.excerpt || 'No source excerpt available.'}</blockquote></div>) : <p>Generated from your prompt and Brand Kit. No document page evidence was supplied.</p>}
            </details>}
            {Object.keys(generatedVariants).length === 0 ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center", color: "var(--color-text-muted)", border: "1px dashed var(--border)", borderRadius: "10px", gap: "14px" }}>
                <Sparkles size={38} style={{ color: "var(--accent)", opacity: 0.8 }} />
                <div>
                  <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem", color: "var(--ink)", fontWeight: 700 }}>Ready for Generation</h3>
                  <p style={{ margin: 0, fontSize: "0.85rem", maxWidth: "290px", lineHeight: 1.5 }}>
                    {activeTab === "pdf"
                      ? "Select extracted claims from your PDF and click Generate to produce channel-specific copy."
                      : "Fill in your topic prompt and generate text posts, or design high-converting visual imagery directly!"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClipdropModal(true)}
                  style={{
                    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                    border: "1px solid rgba(168, 85, 247, 0.5)",
                    color: "#d8b4fe",
                    fontWeight: 600,
                    fontSize: "0.88rem",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    boxShadow: "0 4px 12px rgba(168, 85, 247, 0.15)",
                  }}
                >
                  <Wand2 size={16} /> 🎨 Create AI Visual & Image First
                </button>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <button
                        type="button"
                        onClick={() => setShowClipdropModal(true)}
                        style={{
                          background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                          border: "1px solid rgba(168, 85, 247, 0.4)",
                          color: "var(--accent)",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <Wand2 size={13} /> 🎨 Generate Visual
                      </button>
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
                <div className="social-preview" style={{ background: "var(--border-strong)", borderRadius: "10px", padding: "14px", border: "1px solid var(--border)" }}>
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

                  {attachedVisual ? (
                    <div style={{ margin: "10px 0", borderRadius: "10px", overflow: "hidden", position: "relative", border: "1px solid var(--border)" }}>
                      <img
                        src={attachedVisual.url}
                        alt="Attached Visual"
                        style={{ width: "100%", maxHeight: "240px", objectFit: "cover", display: "block" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowClipdropModal(true)}
                        style={{
                          position: "absolute",
                          bottom: "8px",
                          right: "8px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border-strong)",
                          color: "var(--ink)",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "5px 12px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          backdropFilter: "blur(6px)",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <Wand2 size={13} /> Edit / Change Visual
                      </button>
                    </div>
                  ) : (
                    <div style={{ margin: "10px 0" }}>
                      <button
                        type="button"
                        onClick={() => setShowClipdropModal(true)}
                        style={{
                          background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))",
                          border: "1px dashed rgba(168, 85, 247, 0.5)",
                          color: "var(--accent)",
                          padding: "10px 14px",
                          borderRadius: "10px",
                          fontSize: "0.84rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          width: "100%",
                          justifyContent: "center",
                        }}
                      >
                        <Wand2 size={15} /> 🎨 Generate Visual with AI for {activePreviewPlatform}
                      </button>
                    </div>
                  )}

                  <div className="social-reactions" style={{ display: "flex", gap: "16px", fontSize: "0.75rem", color: "var(--color-text-muted)", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><ThumbsUp size={13} /> Like</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><MessageSquare size={13} /> Comment</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Share2 size={13} /> Share</span>
                  </div>
                </div>

                {/* Save & Preview Actions */}
                <div style={{ marginTop: "auto", paddingTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <Button
                    variant="secondary"
                    onClick={() => setShowClipdropModal(true)}
                    style={{
                      width: "100%",
                      padding: "10px",
                      fontSize: "0.9rem",
                      background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))",
                      border: "1px solid rgba(168, 85, 247, 0.4)",
                      color: "var(--accent)",
                      fontWeight: 600,
                    }}
                  >
                    <Wand2 size={16} />
                    🎨 Generate Visual with Clipdrop AI
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowPreviewModal(true)}
                    disabled={!selectedPlatforms.length || !Object.keys(generatedVariants).length}
                    style={{ width: "100%", padding: "10px", fontSize: "0.9rem" }}
                  >
                    <Layers size={16} />
                    Review platform variants
                  </Button>
                  <Button
                    variant="primary"
                    onClick={()=>handleSaveToLibrary()}
                    disabled={isSaving}
                    style={{ width: "100%", padding: "10px", fontSize: "0.9rem" }}
                  >
                    <Save size={16} />
                    {isSaving ? "Saving for review..." : savedContentId ? "Update & open in Content Library" : "Save to Needs Review"}
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

      <ClipdropImageModal
        composerMode
        attachmentLabel="Image for generated posts · saved for review"
        isOpen={showClipdropModal}
        onClose={() => setShowClipdropModal(false)}
        onAttach={(result) => {
          setAttachedVisual(result);
          if (savedContentId) void handleSaveToLibrary(undefined,false,result);
          toast.success("Attached visual to this draft post!");
        }}
        initialContentText={[
          generatedVariants[activePreviewPlatform] || topic,
          knowledgeItems
            .filter((k) => selectedKnowledgeIds.includes(k.id))
            .map((k) => `${k.knowledge_key}: ${typeof k.value === "string" ? k.value : JSON.stringify(k.value)}`)
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n\nExtracted Knowledge:\n")}
        initialTitle={generatedTitle}
        initialPrompt={posterScript?.prompt}
        targetPlatform={activePreviewPlatform}
        accounts={s?.accounts || []}
        brandName={s?.brand?.name}
        brandWebsite={s?.brand?.website}
        brandCta={s?.brand?.cta}
      />
    </div>
  );
}

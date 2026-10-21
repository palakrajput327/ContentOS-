import fs from 'node:fs';

// 1. Update DocumentSourceMedia.tsx
let dsm = fs.readFileSync('src/components/DocumentSourceMedia.tsx', 'utf8').replace(/\r\n/g, '\n');

const dsmTarget1 = `export function DocumentSourceMedia({
  documentId,
  documentStatus,
  canExtract,
  onKnowledgeChanged,
  onSelectVisual,
}: {
  documentId: string;
  documentStatus: string;
  canExtract: boolean;
  onKnowledgeChanged?: (documentId: string) => void;
  onSelectVisual?: (visual: { assetId: string; url: string; filename: string }) => void;
}) {`;

const dsmRep1 = `export function DocumentSourceMedia({
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
}) {`;

dsm = dsm.replace(dsmTarget1, dsmRep1);

const dsmTarget2 = `        setData(value);
        setError("");`;

const dsmRep2 = `        setData(value);
        setError("");
        // Auto-select first extracted PDF image by default if none selected yet
        if (value.assets?.length > 0 && onSelectVisual && !selectedAssetId) {
          onSelectVisual({
            assetId: value.assets[0].assetId,
            url: value.assets[0].url,
            filename: \`PDF page \${value.assets[0].pageNumber} visual\`,
          });
        }`;

dsm = dsm.replace(dsmTarget2, dsmRep2);

const dsmTarget3 = `                  <Button
                    variant="primary"
                    style={{ marginTop: "6px", width: "100%" }}
                    onClick={() => {
                      onSelectVisual?.({
                        assetId: a.assetId,
                        url: a.url,
                        filename: \`PDF page \${a.pageNumber} visual\`,
                      });
                      toast.success(\`Attached page \${a.pageNumber} visual as post creative!\`);
                    }}
                  >
                    ✨ Use as Post Visual
                  </Button>`;

const dsmRep3 = `                  <Button
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
                        filename: \`PDF page \${a.pageNumber} visual\`,
                      });
                      toast.success(\`Attached page \${a.pageNumber} visual as post creative!\`);
                    }}
                  >
                    {selectedAssetId === a.assetId ? "✓ Active Post Visual (Default)" : "✨ Use as Post Visual"}
                  </Button>`;

dsm = dsm.replace(dsmTarget3, dsmRep3);

fs.writeFileSync('src/components/DocumentSourceMedia.tsx', dsm, 'utf8');
console.log('Updated DocumentSourceMedia.tsx');

// 2. Update AIStudio.tsx
let ais = fs.readFileSync('src/pages/AIStudio.tsx', 'utf8').replace(/\r\n/g, '\n');

// Pass selectedAssetId
ais = ais.replace(
  `{selectedDocId && activeDoc && <DocumentSourceMedia key={selectedDocId} documentId={selectedDocId} documentStatus={activeDoc.status} canExtract={['Owner','Admin','Content Manager','Editor'].includes(s.workspace.role)} onKnowledgeChanged={id=>{if(selectedDocRef.current===id)void fetchKnowledge(id);}} onSelectVisual={visual => setAttachedVisual(visual)} />}`,
  `{selectedDocId && activeDoc && <DocumentSourceMedia key={selectedDocId} documentId={selectedDocId} documentStatus={activeDoc.status} canExtract={['Owner','Admin','Content Manager','Editor'].includes(s.workspace.role)} selectedAssetId={attachedVisual?.assetId} onKnowledgeChanged={id=>{if(selectedDocRef.current===id)void fetchKnowledge(id);}} onSelectVisual={visual => setAttachedVisual(visual)} />}`
);

// Auto-pair in handleSaveToLibrary if visual is null and activeTab is pdf
const saveTarget = `  async function handleSaveToLibrary(generation?: {title:string;variants:Partial<Record<Platform,string>>}, navigate = true, visual = attachedVisual) {
    try {
      setError(null);`;

const saveRep = `  async function handleSaveToLibrary(generation?: {title:string;variants:Partial<Record<Platform,string>>}, navigate = true, visual = attachedVisual) {
    try {
      setError(null);
      let visualToUse = visual;
      if (!visualToUse && activeTab === 'pdf' && selectedDocId) {
        try {
          const media = await request<any>(\`/documents/\${selectedDocId}/source-media\`);
          if (media.assets && media.assets.length > 0) {
            const selectedItems = knowledgeItems.filter(k => selectedKnowledgeIds.includes(k.id));
            const targetPage = selectedItems.find(k => k.page_start)?.page_start;
            const matchedAsset = (targetPage ? media.assets.find((a: any) => a.pageNumber === targetPage) : null) || media.assets[0];
            if (matchedAsset) {
              visualToUse = {
                assetId: matchedAsset.assetId,
                url: matchedAsset.url,
                filename: \`PDF page \${matchedAsset.pageNumber} visual\`,
              };
              setAttachedVisual(visualToUse);
            }
          }
        } catch (e) {
          console.warn("Could not auto-pair PDF visual:", e);
        }
      }`;

ais = ais.replace(saveTarget, saveRep);

// Replace visual with visualToUse in handleSaveToLibrary loop
ais = ais.replace(
  `      for (const [p, val] of Object.entries(variantsToSave)) {
        if (visual) {
          finalVariants[p] = {
            caption: typeof val === "string" ? val : (val as any)?.caption || "",
            mediaAssetId: visual.assetId,
            mediaUrl: visual.url,
            mediaType: "image",
            metadata: {sourceEvidence},
          };
        } else {
          finalVariants[p] = {caption:val,metadata:{sourceEvidence}};
        }
      }`,
  `      for (const [p, val] of Object.entries(variantsToSave)) {
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
      }`
);

fs.writeFileSync('src/pages/AIStudio.tsx', ais, 'utf8');
console.log('Updated AIStudio.tsx');

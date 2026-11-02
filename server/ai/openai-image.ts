export async function generateOpenAIImage(prompt: string, aspectRatio: string, request = fetch): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required for poster generation.");
  const size = aspectRatio === "16:9" ? "1536x1024" : aspectRatio === "1:1" ? "1024x1024" : "1024x1536";
  const response = await request("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare", prompt, size, quality: "medium", n: 1, output_format: "png" }),
    signal: AbortSignal.timeout(180000),
  });
  const result = await response.json() as { data?: { b64_json?: string }[]; error?: { code?: string; type?: string } };
  if (!response.ok) throw new Error(`OpenAI image generation failed (HTTP ${response.status}, ${result.error?.code || result.error?.type || "request_failed"}). Check API billing and model access.`);
  if (!result.data?.[0]?.b64_json) throw new Error("OpenAI did not return an image.");
  return Buffer.from(result.data[0].b64_json, "base64");
}

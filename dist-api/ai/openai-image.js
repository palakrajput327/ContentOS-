export async function generateOpenAIImage(prompt, aspectRatio, request = fetch) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key)
        throw new Error("OPENAI_API_KEY is required for poster generation.");
    const preferredModel = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
    let size = "1024x1024";
    if (preferredModel === "dall-e-3") {
        if (aspectRatio === "16:9" || aspectRatio === "landscape")
            size = "1792x1024";
        else if (aspectRatio === "9:16" || aspectRatio === "4:5" || aspectRatio === "portrait")
            size = "1024x1792";
    }
    // Model sequence: user's preferred model, then modern OpenAI image models
    const modelsToTry = [preferredModel, "gpt-image-1", "gpt-image-2", "chatgpt-image-latest", "dall-e-3"]
        .filter((v, i, a) => a.indexOf(v) === i);
    let lastError = "";
    for (const model of modelsToTry) {
        const payload = {
            model,
            prompt: prompt.slice(0, 4000),
            n: 1,
            size,
        };
        try {
            const response = await request("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(60000),
            });
            const result = (await response.json());
            if (!response.ok) {
                lastError = result.error?.message || result.error?.code || `HTTP ${response.status}`;
                // If the model does not exist on this account, try next candidate
                if (lastError.includes("does not exist") || lastError.includes("invalid_value")) {
                    continue;
                }
                // Quota / credit / billing error: throw immediately to trigger fallback
                throw new Error(`OpenAI image error (${lastError})`);
            }
            const item = result.data?.[0];
            if (!item)
                continue;
            if (item.b64_json) {
                return Buffer.from(item.b64_json, "base64");
            }
            if (item.url) {
                const imgRes = await request(item.url);
                if (!imgRes.ok)
                    throw new Error(`Failed to download OpenAI image from URL: ${imgRes.status}`);
                const arr = await imgRes.arrayBuffer();
                return Buffer.from(new Uint8Array(arr));
            }
        }
        catch (err) {
            if (err.message?.includes("OpenAI image error"))
                throw err;
            lastError = err.message || String(err);
        }
    }
    throw new Error(`OpenAI image generation failed: ${lastError || "all image models exhausted"}`);
}

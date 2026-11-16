async function testHF() {
  const hfToken = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
  console.log('HF Token exists:', !!hfToken);
  if (!hfToken) return;
  const res = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${hfToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: "Commercial fintech poster for TradeOrbit",
    }),
    signal: AbortSignal.timeout(35000),
  });
  console.log('HF Status:', res.status);
}

testHF();


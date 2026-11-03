async function testFreeEndpoints() {
  const prompt = encodeURIComponent('Commercial fintech poster for TradeOrbit, 3D golden text, luxury boardroom, 8k');

  const candidates = [
    `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&model=flux`,
    `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&model=turbo`,
    `https://image.pollinations.ai/prompt/${prompt}?width=768&height=768&nologo=true`,
    `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true`,
  ];

  for (const url of candidates) {
    try {
      console.log('Testing:', url.slice(0, 80));
      const start = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      console.log('Status:', res.status, 'Time:', (Date.now() - start) + 'ms', 'Content-Type:', res.headers.get('content-type'));
      if (res.ok) {
        const buf = await res.arrayBuffer();
        console.log('SUCCESS! Bytes:', buf.byteLength);
        break;
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

testFreeEndpoints();


async function test() {
  const key = (process.env.OPENAI_API_KEY || '').replace(/"/g, '').trim();
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` }
  });
  console.log('OpenAI HTTP Status:', res.status);
  const data = await res.json();
  if (data.data) {
    console.log('All image/gpt models:', data.data.map(m => m.id).filter(id => id.includes('dall') || id.includes('gpt') || id.includes('image')));
  } else {
    console.log('Response:', data);
  }

  // Also test text completion to check billing status
  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })
  });
  console.log('Chat completion HTTP status:', chatRes.status);
  console.log('Chat response:', await chatRes.json());
}

test().catch(console.error);

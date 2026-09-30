import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createLLMProvider } from '../dist-api/ai/llm.service.js';
import { OpenAICompatibleProvider } from '../dist-api/ai/openai-compatible.provider.js';
const messages = [{ role: 'user', content: 'Return JSON with a name.' }];
const env = { LLM_PROVIDER: 'gemini', LLM_FALLBACK_PROVIDERS: 'groq,openrouter', LLM_MAX_RETRIES: '0', GEMINI_API_KEY: 'gemini-test', GEMINI_MODEL: 'gemini-test-model', GROQ_API_KEY: 'groq-test', GROQ_MODEL: 'groq-test-model', OPENROUTER_API_KEY: 'router-test', OPENROUTER_MODEL: 'router-test-model' };
const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }));
async function withFetch(fn, work) { const original = globalThis.fetch; globalThis.fetch = fn; try { await work(); } finally { globalThis.fetch = original; } }
for (const failure of [401, 429, 500, 'network', 'timeout', 'empty']) {
  test('text fallback on ' + failure, async () => {
    const calls = [];
    await withFetch(async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        if (failure === 'network') throw new TypeError('network');
        if (failure === 'timeout') throw new DOMException('timeout', 'TimeoutError');
        if (failure === 'empty') return ok('');
        return new Response('private upstream details', { status: failure });
      }
      return ok('success');
    }, async () => {
      const result = await createLLMProvider(env).generateText({ messages });
      assert.equal(result.provider, 'groq'); assert.equal(result.text, 'success');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(calls[1].options.headers.Authorization, 'Bearer groq-test');
      assert.equal(JSON.parse(calls[1].options.body).model, 'groq-test-model');
    });
  });
}
test('invalid JSON and schema fall through to OpenRouter', async () => {
  const responses = ['not json', '{"name":12}', '{"name":"Company"}'];
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).response_format, { type: 'json_object' });
    if (responses.length === 1) assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    return ok(responses.shift());
  }, async () => {
    const result = await createLLMProvider(env).generateStructured({ messages, schema: z.object({ name: z.string() }) });
    assert.equal(result.provider, 'openrouter'); assert.equal(result.data.name, 'Company');
    assert.equal(result.usage.totalTokens, 5);
  });
});
test('skip missing keys and stop after first success', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return ok('done'); }, async () => {
    const provider = createLLMProvider({ ...env, GEMINI_API_KEY: '' });
    assert.equal(await provider.validateConfiguration(), true);
    assert.equal((await provider.generateText({ messages })).provider, 'groq'); assert.equal(calls, 1);
  });
});
test('all failures give safe aggregate error', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return new Response('secret', { status: 403 }); }, async () => {
    await assert.rejects(createLLMProvider(env).generateText({ messages }), /All 3 configured LLM providers failed/);
    assert.equal(calls, 3);
  });
});
test('configuration validation and explicit mock isolation', async () => {
  const p = createLLMProvider({ LLM_PROVIDER: 'gemini' });
  assert.equal(await p.validateConfiguration(), false);
  await assert.rejects(p.generateText({ messages }), /No configured LLM provider/);
  for (const config of [{ LLM_PROVIDER: 'typo' }, { ...env, GEMINI_MODEL: '' }, { ...env, LLM_MAX_RETRIES: 'oops' }, { LLM_PROVIDER: 'mock', LLM_FALLBACK_PROVIDERS: 'groq' }, { ...env, LLM_FALLBACK_PROVIDERS: 'mock' }]) assert.throws(() => createLLMProvider(config));
});
test('legacy single provider configuration', async () => {
  await withFetch(async (url) => { assert.equal(url, 'https://example.com/v1/chat/completions'); return ok('legacy'); }, async () => {
    const p = createLLMProvider({ LLM_API_KEY: 'test', LLM_BASE_URL: 'https://example.com/v1', LLM_MODEL: 'legacy', LLM_MAX_RETRIES: '0' });
    assert.equal((await p.generateText({ messages })).text, 'legacy');
  });
});
test('default retries do not skip requests when env is unset', async () => {
  const previous = process.env.LLM_MAX_RETRIES; delete process.env.LLM_MAX_RETRIES;
  try { await withFetch(async () => ok('ok'), async () => {
    assert.equal((await new OpenAICompatibleProvider({ apiKey: 'test' }).generateText({ messages })).text, 'ok');
  }); } finally { if (previous !== undefined) process.env.LLM_MAX_RETRIES = previous; }
});

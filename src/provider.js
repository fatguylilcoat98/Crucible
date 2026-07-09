// LLM provider layer. One real provider (Anthropic Messages API over fetch —
// no SDK dependency) and one mock provider so the whole protocol can run and
// be tested offline.

import { config } from './config.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class AnthropicProvider {
  constructor({ apiKey = config.apiKey, model = config.model, maxTokens = config.maxTokens } = {}) {
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. The Crucible needs a Claude API key to convene the council.',
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  /**
   * Send one system+user exchange, return the assistant text.
   * Retries transient failures (429/5xx/network) with exponential backoff.
   */
  async complete({ system, user, maxTokens }) {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: maxTokens || this.maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });

    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** attempt);
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': API_VERSION,
          },
          body,
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Anthropic API ${res.status}: ${await res.text()}`);
          continue;
        }
        if (!res.ok) {
          throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        return (data.content || [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
      } catch (err) {
        // fetch network errors are retryable; API 4xx errors thrown above are not.
        if (String(err.message).startsWith('Anthropic API 4')) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }
}

/**
 * Deterministic offline provider. `responses` maps a marker string (searched
 * for in the system prompt) to either a fixed reply or a function of the
 * request. Used by the test suite and by `--mock` demo mode.
 */
export class MockProvider {
  constructor(responses = {}) {
    this.responses = responses;
    this.calls = [];
  }

  async complete(req) {
    this.calls.push(req);
    for (const [marker, reply] of Object.entries(this.responses)) {
      if (req.system.includes(marker)) {
        return typeof reply === 'function' ? reply(req) : reply;
      }
    }
    throw new Error(`MockProvider: no canned response matches system prompt: ${req.system.slice(0, 80)}...`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

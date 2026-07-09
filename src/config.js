// Central configuration. Everything is overridable by environment variable so
// the engine can be pointed at different models or a local ledger directory
// without touching code.

import path from 'node:path';

export const config = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.CRUCIBLE_MODEL || 'claude-sonnet-5',
  // The council runs several independent minds in parallel; keep individual
  // responses bounded so a session stays fast and dense rather than rambling.
  maxTokens: Number(process.env.CRUCIBLE_MAX_TOKENS || 2000),
  ledgerDir: process.env.CRUCIBLE_LEDGER_DIR || path.resolve('crucible-ledger'),
  // Render (and most PaaS hosts) inject PORT; CRUCIBLE_PORT wins locally.
  port: Number(process.env.CRUCIBLE_PORT || process.env.PORT || 4517),
  // When set, every /api/* request must carry this key in the
  // x-crucible-key header. Mandatory for any deployment that is not
  // localhost: the API spends your Anthropic credits and the ledger is
  // your private thinking.
  accessKey: process.env.CRUCIBLE_ACCESS_KEY || '',
};

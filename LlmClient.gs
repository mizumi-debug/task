// LlmClient.gs
// Anthropic Messages API を raw HTTP (UrlFetchApp) で呼び出す。
// Apps ScriptはnpmパッケージのAnthropic公式SDKを利用できないため、REST APIを直接叩く。

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

/** Script Property "CLAUDE_MODEL" があればそちらを優先(コスト重視でモデルを下げたい場合用)。 */
function getClaudeModel_() {
  const override = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL');
  return override || DEFAULT_CLAUDE_MODEL;
}

/**
 * systemPrompt/userPromptを渡し、Claudeのテキスト応答(先頭のtextブロック)を返す。
 * 会話履歴やツール呼び出しは扱わない、1回完結のシンプルな呼び出し専用。
 */
function callClaude_(systemPrompt, userPrompt) {
  const apiKey = getScriptProp_('CLAUDE_API_KEY');

  const payload = {
    model: getClaudeModel_(),
    max_tokens: 4096,
    output_config: { effort: 'low' }, // 短文比較なので低コストのeffortで十分
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  const response = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Claude API error ' + code + ': ' + body);
  }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal') {
    throw new Error('Claude refused the request: ' + JSON.stringify(json.stop_details));
  }
  const textBlock = (json.content || []).find((block) => block.type === 'text');
  return textBlock ? textBlock.text : '';
}

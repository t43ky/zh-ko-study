/* AI 번역 (Claude) - 메인 프로세스에서만 실행 (API 키가 화면 쪽으로 가지 않음)
 * 사용자가 설정에 자기 Anthropic API 키를 넣었을 때만 동작한다.
 * 한 번의 요청으로: 자연스러운 한국어 번역 + 단어별 "이 문장에서의 뜻" + 짧은 문법 포인트
 */
'use strict';

const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');

const MODELS = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (빠르고 저렴, 권장)', effort: 'low' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (더 꼼꼼함, 약 20배 비쌈)', effort: 'low' },
};
const DEFAULT_MODEL = 'claude-haiku-5-5';

const ResultSchema = z.object({
  translation: z.string(),
  words: z.array(
    z.object({
      i: z.number().int(),
      meaning: z.string(),
    })
  ),
  note: z.string(),
});

const SYSTEM = `당신은 한국인 중국어 학습자를 돕는 중→한 번역가입니다.
입력으로 중국어 원문과, 원문을 단어로 나눈 목록(번호: 단어)이 주어집니다.

다음을 만드세요.
1. translation: 원문 전체를 자연스럽고 정확한 한국어로 번역. 문맥(앞뒤 문장, 말투, 생략된 주어)을 살려 한국어답게 쓰되 원문의 뜻을 더하거나 빼지 마세요. 원문에 여러 문장이 있으면 문장 구분을 유지하세요.
2. words: 목록의 각 중국어 단어마다, 바로 이 문장에서 쓰인 뜻을 짧은 한국어로 (보통 2~12자). 사전의 여러 뜻을 나열하지 말고 이 문맥에 맞는 뜻 하나만 쓰세요. 了·的·得·吧·把·被 같은 기능어는 이 문장에서 하는 역할을 짧게 쓰세요(예: "완료", "~의", "정도 보어 연결", "제안"). i 는 목록의 번호입니다. 문장부호나 숫자만 있는 항목은 빼도 됩니다.
3. note: 이 문장을 이해하는 데 가장 도움이 되는 문법·표현 포인트 하나를 한국어 한두 문장으로. 특별한 것이 없으면 빈 문자열.`;

function createAi({ getConfig, setConfig, safeStorage }) {
  let client = null;
  let clientKey = '';
  const cache = new Map();

  function getKey() {
    const c = getConfig();
    if (!c.aiKeyEnc) return '';
    try {
      const buf = Buffer.from(c.aiKeyEnc, 'base64');
      return c.aiKeyEncrypted && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    } catch {
      return '';
    }
  }

  function storeKey(key) {
    if (!key) return setConfig({ aiKeyEnc: '', aiKeyEncrypted: false });
    // Windows 에서는 사용자 계정으로 암호화(DPAPI)해서 저장
    if (safeStorage.isEncryptionAvailable()) {
      setConfig({ aiKeyEnc: safeStorage.encryptString(key).toString('base64'), aiKeyEncrypted: true });
    } else {
      setConfig({ aiKeyEnc: Buffer.from(key, 'utf8').toString('base64'), aiKeyEncrypted: false });
    }
  }

  function getClient() {
    const key = getKey();
    if (!key) return null;
    if (!client || clientKey !== key) {
      client = new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 });
      clientKey = key;
      cache.clear();
    }
    return client;
  }

  function status() {
    const c = getConfig();
    const model = MODELS[c.aiModel] ? c.aiModel : DEFAULT_MODEL;
    return {
      hasKey: !!getKey(),
      enabled: c.aiEnabled !== false,
      model,
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
    };
  }

  const isOn = () => {
    const s = status();
    return s.hasKey && s.enabled;
  };

  function friendlyError(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않습니다';
    if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 해당 모델을 쓸 수 없습니다';
    if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요';
    if (e instanceof Anthropic.BadRequestError) return '요청 오류: ' + e.message;
    if (e instanceof Anthropic.APIConnectionError) return 'Claude 서버에 연결하지 못했습니다';
    if (e instanceof Anthropic.APIError) return `Claude 서버 오류 (${e.status})`;
    return (e && e.message) || String(e);
  }

  // text: 원문, tokens: 단어 목록(문자열 배열, 화면의 단어 박스와 같은 순서)
  async function translate(text, tokens) {
    const c = getClient();
    if (!c) throw new Error('API 키가 없습니다');
    const { model } = status();
    const list = (tokens || []).map((t, i) => (/[㐀-鿿豈-﫿]/.test(t) ? `${i}: ${t}` : null)).filter(Boolean);
    const key = model + '\u0000' + text + '\u0000' + list.join('|');
    if (cache.has(key)) return cache.get(key);

    const p = (async () => {
      const res = await c.messages.parse({
        model,
        max_tokens: 4096,
        output_config: { effort: MODELS[model].effort, format: zodOutputFormat(ResultSchema) },
        system: SYSTEM,
        messages: [{ role: 'user', content: `원문:\n${text}\n\n단어 목록:\n${list.join('\n')}` }],
      });
      if (res.stop_reason === 'refusal') throw new Error('Claude 가 이 문장의 처리를 거절했습니다');
      if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸습니다');
      const out = res.parsed_output;
      if (!out) throw new Error('응답 형식 오류');
      const words = {};
      for (const w of out.words) if (Number.isInteger(w.i) && w.meaning) words[w.i] = w.meaning.trim();
      return { translation: out.translation.trim(), words, note: (out.note || '').trim(), model };
    })();
    cache.set(key, p);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    try {
      return await p;
    } catch (e) {
      cache.delete(key);
      throw new Error(friendlyError(e));
    }
  }

  async function test() {
    const r = await translate('你说得对。', ['你', '说', '得', '对', '。']);
    return r.translation;
  }

  return { status, isOn, storeKey, translate, test, MODELS, DEFAULT_MODEL };
}

module.exports = { createAi };

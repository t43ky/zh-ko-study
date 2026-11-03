/* 화면 글자 인식(OCR) - tesseract.js 를 앱 안에 포함해 오프라인으로 동작 */
'use strict';
window.ZhKoOCR = (() => {
  const base = new URL('ocr/', location.href).href;
  const workers = {};
  let progressCb = null;

  function getWorker(lang) {
    if (!workers[lang]) {
      workers[lang] = Tesseract.createWorker(lang, 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
        logger: (m) => progressCb && progressCb(m),
      }).catch((e) => {
        delete workers[lang];
        throw e;
      });
    }
    return workers[lang];
  }

  // 인식 결과 정리: 한자 사이 공백 제거, 줄바꿈 합치기
  function clean(text) {
    const CJK = '[\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
    return String(text || '')
      .replace(/\r/g, '')
      .replace(new RegExp(`(${CJK})[ \\t]+(?=${CJK})`, 'g'), '$1')
      .replace(new RegExp(`(${CJK})\\n+(?=${CJK})`, 'g'), '$1')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{2,}/g, '\n')
      // 한자 옆의 반각 문장부호 → 전각 (인식기가 ？ 를 ? 로 읽는 경우 등)
      .replace(new RegExp(`(${CJK})\\s*([?!,:;])`, 'g'), (_, c, p) => c + { '?': '？', '!': '！', ',': '，', ':': '：', ';': '；' }[p])
      .trim();
  }

  // 작은 글자는 키우고 흑백으로 바꿔 인식률을 높인다
  function prepare(canvas) {
    const minSide = Math.min(canvas.width, canvas.height);
    const scale = minSide < 60 ? 3 : canvas.width * canvas.height < 600000 ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * scale);
    c.height = Math.round(canvas.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
      sum += g;
    }
    // 어두운 배경(다크 모드)이면 반전
    if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function recognize(canvas, { lang = 'chi_sim', onProgress } = {}) {
    progressCb = onProgress || null;
    const w = await getWorker(lang);
    const { data } = await w.recognize(prepare(canvas));
    progressCb = null;
    return clean(data.text);
  }

  // 미리 불러와 두면 첫 인식이 빨라진다
  const warmup = (lang = 'chi_sim') => getWorker(lang).catch(() => {});

  return { recognize, warmup, clean };
})();

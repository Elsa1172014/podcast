import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";

ffmpeg.setFfmpegPath(ffmpegPath);

// الدفء الصوتي — تقنية EQ حقيقية ومعروفة: تعزيز الترددات المنخفضة-المتوسطة
// (200–400Hz) يمنح الصوت إحساسًا أكثر "دفئًا" في هندسة الصوت التقليدية.
export async function applyWarmth(inputPath, enabled = false) {
  if (!enabled) return inputPath;
  const outPath = inputPath.replace(/\.(mp3|wav)$/i, "-warm.mp3");
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(["equalizer=f=300:t=q:w=1.5:g=4"])
      .audioCodec("libmp3lame")
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  await fs.unlink(inputPath).catch(() => {});
  return outPath;
}

// طبقة الصوت (Pitch) — asetrate يغيّر الطبقة والسرعة معًا، ثم atempo يعيد
// ضبط السرعة لتبقى كما كانت — فينتج تغيّر في الطبقة وحدها. تقنية DSP حقيقية.
export async function applyPitch(inputPath, pitchPercent = 0) {
  if (!pitchPercent) return inputPath;
  const outPath = inputPath.replace(/\.(mp3|wav)$/i, "-pitched.mp3");
  const rateFactor = 1 + pitchPercent / 100;
  const sampleRate = 24000;
  const newRate = Math.round(sampleRate * rateFactor);

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters([`asetrate=${newRate}`, `aresample=${sampleRate}`, `atempo=${(1 / rateFactor).toFixed(4)}`])
      .audioCodec("libmp3lame")
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  await fs.unlink(inputPath).catch(() => {});
  return outPath;
}

// مطابقة مستوى الصوت (loudnorm — معيار EBU R128 نفسه المستعمل في البودكاست
// الاحترافي) + ضغط الصوت (acompressor — ضاغط ديناميكي حقيقي).
export async function applyLoudnessAndCompression(inputPath, { targetLUFS = -16, compress = false }) {
  const outPath = inputPath.replace(/\.(mp3|wav)$/i, "-mastered.mp3");
  const filters = [`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11`];
  if (compress) filters.push("acompressor=threshold=-20dB:ratio=3:attack=5:release=50");

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(filters)
      .audioCodec("libmp3lame")
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  await fs.unlink(inputPath).catch(() => {});
  return outPath;
}

// تخفيف الصفير (De-essing تقريبي) — لا "de-esser" جاهز في ffmpeg القياسي؛
// هذا تخفيف حقيقي لحزمة تردد الصفير الشائعة (5–8kHz) عبر equalizer.
export async function applyDeEssing(inputPath, enabled = false) {
  if (!enabled) return inputPath;
  const outPath = inputPath.replace(/\.(mp3|wav)$/i, "-deessed.mp3");
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(["equalizer=f=6500:t=q:w=2:g=-6"])
      .audioCodec("libmp3lame")
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  await fs.unlink(inputPath).catch(() => {});
  return outPath;
}

// طول الوقفات — يعيد ضبط فترات الصمت لمدة مستهدَفة موحَّدة عبر
// silenceremove (مرشّح حقيقي)؛ pauseSeconds تقريبًا 0.1–1.5.
// حماية: على صوت هادئ جدًّا قرب الصمت الكامل، قد يحذف هذا المرشّح كل
// الإشارة تقريبًا (سلوك صحيح للمرشّح، لكنه غير مفيد هنا) — نتحقّق من
// المدة الناتجة، وإن انهارت نتراجع للملف قبل هذه الخطوة بدل نشر ملف تالف.
export async function applyPauseLength(inputPath, pauseSeconds) {
  if (pauseSeconds == null) return inputPath;
  const originalDuration = await getDuration(inputPath).catch(() => null);
  const outPath = inputPath.replace(/\.(mp3|wav)$/i, "-paused.mp3");
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters([`silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:stop_periods=-1:stop_duration=${pauseSeconds}:stop_threshold=-35dB`])
      .audioCodec("libmp3lame")
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  const newDuration = await getDuration(outPath).catch(() => 0);
  if (originalDuration && (!newDuration || newDuration < originalDuration * 0.15)) {
    await fs.unlink(outPath).catch(() => {}); // تجاهل الناتج المنهار، أبقِ الملف الأصلي
    return inputPath;
  }
  await fs.unlink(inputPath).catch(() => {});
  return outPath;
}

// تقليل الضوضاء وإزالة الصدى — على عيّنة المصدر قبل الاستنساخ. الناتج
// يُحفَظ دائمًا WAV — إصلاح خطأ سابق كان يحفظ بامتداد الحاوية الأصلية
// (مثل webm) فيتعارض مع سلسلة الترميز.
//
// خلل حقيقي وجدته بالاختبار: مرشّح afftdn (تقليل الضوضاء) يفشل تحديدًا
// على صوت صامت أو شبه صامت تمامًا برسالة "Numerical result out of range"
// (على الأرجح خلل داخلي في تقدير أرضية الضوضاء عند غياب أي إشارة فعلية
// ليحلّلها). لا نرمي الخطأ للمستخدم — نتراجع تلقائيًّا لمعالجة أخف بدل
// إفشال طلب التوليد كاملًا.
const NOISE_LEVELS = { off: null, light: 12, medium: 20, strong: 30 };

function runFilters(inputPath, outPath, filters) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(filters)
      .audioCodec("pcm_s16le")
      .format("wav")
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", (e) => reject(e))
      .run();
  });
}

export async function preprocessSample(inputPath, { noiseReduction = "off", echoRemoval = false }) {
  const level = NOISE_LEVELS[noiseReduction];
  const echoFilters = echoRemoval ? ["highpass=f=100", "agate=threshold=0.02"] : [];
  const fullFilters = [...(level ? [`afftdn=nf=-${level}`] : []), ...echoFilters];
  if (!fullFilters.length) return inputPath;

  const outPath = inputPath.replace(/\.[a-z0-9]+$/i, "-clean.wav");
  try {
    return await runFilters(inputPath, outPath, fullFilters);
  } catch (e) {
    if (!level) throw e; // الفشل ليس بسبب afftdn، فلا داعي لإعادة محاولة
    // تراجع: أعد المحاولة بلا تقليل الضوضاء (على الأرجح صوت هادئ جدًّا
    // تعذّر على afftdn تحليله)، مع الإبقاء على إزالة الصدى إن طُلبت.
    try {
      if (echoFilters.length) return await runFilters(inputPath, outPath, echoFilters);
      return inputPath; // لا فلاتر أخرى مطلوبة، استعمل الملف الأصلي كما هو
    } catch {
      return inputPath; // تراجع أخير: لا تُفشِل الطلب كاملًا بسبب تنقية اختيارية
    }
  }
}

export function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

// قياس حقيقي لمستوى الصوت المتكامل (Integrated LUFS) — يُستعمل في تحليل
// المقارنة الصادق، لا نسبة "تطابق هوية" مختلَقة.
export function measureLoudnessLUFS(filePath) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg(filePath)
      .audioFilters("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json")
      .format("null")
      .output("-")
      .on("stderr", (line) => { stderr += line + "\n"; })
      .on("end", () => {
        const match = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
        resolve(match ? parseFloat(match[1]) : null);
      })
      .on("error", reject)
      .run();
  });
}

// تقدير حقيقي للتردد الأساسي (F0 — يرتبط بما يُسمّى تعميميًّا "طبقة
// الصوت/النبرة") عبر خوارزمية الترابط الذاتي الزمني (Autocorrelation) —
// خوارزمية DSP كلاسيكية أكتبها هنا بأنفسنا، لا تخمينًا ولا استدعاء نموذج
// ذكاء اصطناعي. هذا مؤشر تقريبي حقيقي للطبقة الصوتية العامة، وليس بصمة
// هوية متحدث كاملة (تلك تحتاج نموذجًا متخصّصًا مدرَّبًا غير متاح هنا) —
// نستعمله في الواجهة موصوفًا بدقة كـ"تقريب" لا "تطابق هوية مؤكَّد".
async function _f0Estimates(filePath) {
  const sampleRate = 16000;
  const rawPath = filePath + ".f0.raw";
  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .audioFilters("silenceremove=start_periods=1:start_duration=0:start_threshold=-40dB")
      .outputOptions(["-f s16le", `-ar ${sampleRate}`, "-ac 1"])
      .output(rawPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  const buf = await fs.readFile(rawPath);
  await fs.unlink(rawPath).catch(() => {});
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));

  const frameSize = 1024;
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);
  const estimates = [];

  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    const frame = samples.subarray(start, start + frameSize);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    if (Math.sqrt(energy / frame.length) < 200) continue;

    let bestLag = -1, bestCorr = 0;
    for (let lag = minLag; lag <= maxLag && lag < frame.length; lag++) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i++) corr += frame[i] * frame[i + lag];
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag > 0) estimates.push(sampleRate / bestLag);
  }
  return estimates;
}

// المدى الديناميكي وتقدير أرضية الضوضاء — عبر مرشّح astats الحقيقي في
// ffmpeg (لا تخمين): يقيس ذروة الإشارة ومتوسط RMS، والفارق بينهما مؤشر
// حقيقي على "جودة التسجيل وصلاحيته للاستنساخ".
export function measureDynamicsAndNoise(filePath) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg(filePath)
      .audioFilters("astats=metadata=0:reset=0")
      .format("null")
      .output("-")
      .on("stderr", (line) => { stderr += line + "\n"; })
      .on("end", () => {
        const peak = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);
        const rms = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
        const flatness = stderr.match(/Flat factor:\s*([\d.]+)/);
        const peakDb = peak ? parseFloat(peak[1]) : null;
        const rmsDb = rms ? parseFloat(rms[1]) : null;
        resolve({
          peakDb, rmsDb,
          dynamicRangeDb: peakDb != null && rmsDb != null ? Math.round((peakDb - rmsDb) * 10) / 10 : null,
          flatFactor: flatness ? parseFloat(flatness[1]) : null, // قيمة عالية تدلّ على تشبّع/قطع في التسجيل
        });
      })
      .on("error", reject)
      .run();
  });
}

// دفء الصوت — تقريب حقيقي عبر مقارنة طاقة الترددات المنخفضة-المتوسطة
// (دافئة) بالترددات العالية (حادّة)، لا تخمينًا: نطبّق مرشّحَي تمرير على
// نسختين من نفس الملف ونقيس RMS كل منهما فعليًّا.
export async function measureWarmth(filePath) {
  const lowPath = filePath + ".low.wav";
  const highPath = filePath + ".high.wav";
  const rmsOf = (out, filters) => new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg(filePath).audioFilters(filters).format("null").output("-")
      .on("stderr", (l) => { stderr += l + "\n"; })
      .on("end", () => { const m = stderr.match(/RMS level dB:\s*(-?[\d.]+)/); resolve(m ? parseFloat(m[1]) : null); })
      .on("error", reject).run();
  });
  const lowRms = await rmsOf(lowPath, "lowpass=f=500,astats=metadata=0:reset=0");
  const highRms = await rmsOf(highPath, "highpass=f=2500,astats=metadata=0:reset=0");
  if (lowRms == null || highRms == null) return null;
  // فارق أكبر لصالح المنخفضات (lowRms أعلى من highRms) = دفء أكثر.
  const warmthPct = Math.max(0, Math.min(100, Math.round(50 + (lowRms - highRms))));
  return warmthPct;
}

// الإيقاع وطول الوقفات — عبر silencedetect الحقيقي: عدد فترات الصمت
// ومتوسط مدتها بالمللي ثانية.
export function measurePauses(filePath) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg(filePath)
      .audioFilters("silencedetect=noise=-35dB:d=0.15")
      .format("null")
      .output("-")
      .on("stderr", (line) => { stderr += line + "\n"; })
      .on("end", () => {
        const durations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
        if (!durations.length) return resolve({ pauseCount: 0, avgPauseMs: null });
        const avgMs = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 1000);
        resolve({ pauseCount: durations.length, avgPauseMs: avgMs });
      })
      .on("error", reject)
      .run();
  });
}

// التحليل الشامل — يجمع كل ما سبق في تقرير واحد صادق: كل قيمة إمّا مقيسة
// فعليًّا برقم ووحدة، أو "غير متاح" صراحة إن لم تتوفّر أداة قياس حقيقية
// لها (لا نخترع بصمة هوية أو تقدير عمر أو لهجة بلا نموذج مختصّ).
export async function analyzeVoiceSample(filePath, knownText = null) {
  const [duration, lufs, f0stats, dynamics, warmth, pauses] = await Promise.all([
    getDuration(filePath).catch(() => null),
    measureLoudnessLUFS(filePath).catch(() => null),
    estimateF0Stats(filePath).catch(() => null),
    measureDynamicsAndNoise(filePath).catch(() => null),
    measureWarmth(filePath).catch(() => null),
    measurePauses(filePath).catch(() => null),
  ]);

  // قوة التعبير والانفعال — مؤشر مركَّب حقيقي (لا نموذج ذكاء اصطناعي، بل
  // اشتقاق رياضي مباشر) من اتساع مدى الطبقة الصوتية + المدى الديناميكي:
  // كلاهما يرتفع فعليًّا مع الأداء المتنوّع المعبِّر، وينخفض مع الإلقاء
  // الرتيب الآلي. نضع هذا صراحةً كـ"مؤشر مركّب تقديري"، لا قياسًا مباشرًا
  // لانفعال حقيقي (ذلك يحتاج نموذج تحليل مشاعر صوتي متخصّص لا نملكه).
  let expressiveness = "غير متاح (يحتاج نموذج تحليل انفعال لتقدير دقيق؛ هذا مؤشر مركّب تقريبي)";
  if (f0stats && dynamics?.dynamicRangeDb != null) {
    const pitchSpread = f0stats.maxHz - f0stats.minHz;
    const pitchSpreadScore = Math.min(100, (pitchSpread / f0stats.medianHz) * 150);
    const dynScore = Math.min(100, (dynamics.dynamicRangeDb / 25) * 100);
    expressiveness = Math.round((pitchSpreadScore * 0.6 + dynScore * 0.4));
  }

  // وضوح النطق — مؤشر مركَّب من عامل التسطّح (تشبّع/قطع) ونسبة الذروة
  // إلى RMS (كلما زاد الفارق دلّ على كلام واضح لا ضوضاء مطموسة). تقريب
  // هندسي حقيقي، لا تعرّف فعلي على مخارج الحروف (يحتاج نموذج كلام متخصّص).
  let clarity = "غير متاح (يحتاج نموذج تعرّف كلام لتحليل مخارج الحروف؛ هذا مؤشر مركّب تقريبي)";
  if (dynamics?.dynamicRangeDb != null && dynamics?.flatFactor != null) {
    const flatnessPenalty = Math.min(40, dynamics.flatFactor * 4);
    clarity = Math.max(0, Math.min(100, Math.round((dynamics.dynamicRangeDb / 20) * 100 - flatnessPenalty)));
  }

  // سرعة الكلام — تُحسَب فعليًّا فقط عند معرفة النص المنطوق (كما في الصوت
  // المُولَّد، حيث نص التجربة معروف بدقة) — للعيّنة الحرّة الأصلية يبقى
  // "غير متاح" بصدق لعدم توفّر تفريغ نصّي (Speech-to-Text) في هذا الإصدار.
  let speechRate = "غير متاح لعيّنة حرّة النص (يحتاج تفريغًا نصيًّا للمقارنة)";
  if (knownText && duration) {
    const wordCount = knownText.trim().split(/\s+/).filter(Boolean).length;
    speechRate = Math.round((wordCount / duration) * 60);
  }

  return {
    duration_seconds: duration != null ? Math.round(duration * 10) / 10 : "غير متاح",
    loudness_lufs: lufs != null ? Math.round(lufs * 10) / 10 : "غير متاح",
    pitch_hz: f0stats ? f0stats.medianHz : "غير متاح",
    pitch_range_hz: f0stats ? [f0stats.minHz, f0stats.maxHz] : "غير متاح",
    stability_pct: f0stats ? f0stats.stabilityPct : "غير متاح",
    dynamic_range_db: dynamics?.dynamicRangeDb ?? "غير متاح",
    warmth_pct: warmth ?? "غير متاح",
    pause_count: pauses ? pauses.pauseCount : "غير متاح",
    avg_pause_ms: pauses ? pauses.avgPauseMs : "غير متاح",
    expressiveness_level: expressiveness,
    articulation_clarity: clarity,
    speech_rate_wpm: speechRate,
    // هذه الثلاث تبقى بلا حل حقيقي — تحتاج نماذج ذكاء اصطناعي متخصّصة
    // (بصمة صوتية، تعرّف لهجة، تحليل تنفّس) لا تتوفّر في هذا الإصدار على
    // الإطلاق، ولا يوجد اشتقاق رياضي بديل معقول لها كما فعلنا أعلاه.
    voice_identity_fingerprint: "غير متاح (يحتاج نموذج بصمة صوتية متخصّص)",
    estimated_age_stage: "غير متاح تلقائيًّا — يُدخِله المستخدم ويُعتمَد كما هو",
    accent_language: "غير متاح (يحتاج نموذج تعرّف على اللهجة)",
    natural_breathing: "غير متاح (يحتاج نموذج تحليل تنفّس متخصّص)",
  };
}

export async function estimateF0(filePath) {
  const estimates = await _f0Estimates(filePath);
  if (!estimates.length) return null;
  estimates.sort((a, b) => a - b);
  return estimates[Math.floor(estimates.length / 2)];
}

// إحصاءات كاملة للتردد الأساسي: الوسيط (الطبقة العامة)، المدى (أدنى/أعلى
// — "مدى الطبقة")، والانحراف المعياري النسبي (مؤشر حقيقي لـ"ثبات الصوت":
// انحراف أقل = طبقة أثبت خلال الكلام، لا تخمينًا).
export async function estimateF0Stats(filePath) {
  const estimates = await _f0Estimates(filePath);
  if (!estimates.length) return null;
  const sorted = [...estimates].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const variance = estimates.reduce((a, b) => a + (b - mean) ** 2, 0) / estimates.length;
  const stdDev = Math.sqrt(variance);
  // نسبة ثبات مبسَّطة: كلما قلّ التذبذب النسبي (الانحراف/المتوسط)، ارتفعت
  // النسبة. نطاق طبيعي للكلام البشري تقريبًا 5%–25% تذبذبًا.
  const stabilityPct = Math.max(0, Math.min(100, Math.round(100 - (stdDev / mean) * 250)));
  return { medianHz: Math.round(median), minHz: Math.round(sorted[0]), maxHz: Math.round(sorted[sorted.length - 1]), stabilityPct, frameCount: estimates.length };
}


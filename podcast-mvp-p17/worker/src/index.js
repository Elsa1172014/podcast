import "dotenv/config";
import express from "express";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { produceEpisode } from "./produceEpisode.js";
import { createClient } from "@supabase/supabase-js";
import { textToSpeech, cloneVoice, getVoiceLibrary, deleteVoice, listClonedVoices } from "./services/elevenlabs.js";
import { applyPitch, applyLoudnessAndCompression, applyDeEssing, applyPauseLength, applyWarmth, preprocessSample, getDuration, measureLoudnessLUFS, estimateF0, analyzeVoiceSample } from "./services/audioPost.js";

const app = express();
app.use(express.json({ limit: "15mb" })); // يتّسع لعينة صوت مرفَقة بصيغة base64 عند التجربة قبل الحفظ

function checkSecret(req, res) {
  const secret = req.headers["x-worker-secret"];
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

// فحص صحة بسيط — يُستعمل أيضًا "لإيقاظ" الخدمة يدويًّا إن احتجت ذلك.
app.get("/", (req, res) => res.json({ ok: true, service: "podcast-worker" }));

app.post("/produce", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId مطلوب" });

  // نردّ فورًا، والمعالجة الفعلية تكمل في الخلفية — الواجهة تتابع التقدّم
  // عبر قراءة عمود progress_pct مباشرة من Supabase (لديها صلاحية القراءة أصلًا).
  res.status(202).json({ accepted: true });
  produceEpisode(projectId).catch((e) => console.error("فشل إنتاج الحلقة:", projectId, e.message));
});

// مكتبة الأصوات الجاهزة الحقيقية من ElevenLabs — تُعرَض في صفحة "ربط
// الأصوات" كبديل عن الاستنساخ الشخصي.
app.get("/voices/library", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const voices = await getVoiceLibrary();
    res.json({ voices });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// حذف صوت مستنسَخ واحد — يُستدعى عند استبدال عيّنة قبل اعتمادها، حتى لا
// تتراكم نسخ تجريبية غير مستخدَمة على حساب ElevenLabs (له حدّ 10 أصوات
// في خطة Starter). فشل الحذف لا يُوقف تدفّق المستخدم — أفضل تسريب بطيء
// من كسر التجربة الأساسية.
app.post("/delete-voice", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { voiceId } = req.body || {};
  if (!voiceId) return res.status(400).json({ error: "voiceId مطلوب" });
  try {
    await deleteVoice(voiceId);
    res.json({ deleted: true });
  } catch (e) {
    res.status(200).json({ deleted: false, error: String(e.message || e) }); // 200 عمدًا: لا نكسر تجربة المستخدم بسبب فشل تنظيف
  }
});

// تنظيف شامل: يحذف كل صوت مستنسَخ على الحساب غير مرتبط بأي عيّنة "مُعتمَدة"
// في قاعدة البيانات — يستعيد المساحة التي استهلكتها محاولات تجريبية قديمة
// لم تُعتمَد قط.
app.post("/cleanup-voices", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: approved, error } = await supabase.from("voice_samples").select("voice_model_id").eq("is_approved", true).not("voice_model_id", "is", null);
    if (error) throw new Error(error.message);
    const approvedIds = new Set((approved || []).map((r) => r.voice_model_id));

    const allVoices = await listClonedVoices();
    const orphans = allVoices.filter((v) => !approvedIds.has(v.voiceId));

    let deleted = 0;
    for (const v of orphans) {
      try { await deleteVoice(v.voiceId); deleted++; } catch { /* استمر بالباقي حتى لو فشل واحد */ }
    }
    res.json({ deletedCount: deleted, totalBefore: allVoices.length, keptApproved: approvedIds.size });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// يمنع ضغط زر "توليد عينة تجريبية" أثناء معالجة سابقة لنفس المستخدم من
// إطلاق طلبين متزامنين يستهلكان رصيد ElevenLabs بلا داعٍ.
const busyPreviews = new Set();

// تجربة صوت قبل الحفظ النهائي — يطبّق نفس سلسلة المعالجة الحقيقية
// (تنظيف العيّنة قبل الاستنساخ، تعديل الطبقة والمستوى بعد التوليد)
// التي ستُستعمل في الإنتاج الفعلي، لا نسخة مبسَّطة مضلِّلة.
// تحليل عيّنة صوتية حقيقي — يُستعمل في مسار "استنساخ صوت" المستقل، قبل
// الاستنساخ وبعده (للمقارنة). كل قيمة إمّا مقيسة فعليًّا أو "غير متاح" صراحة.
app.post("/analyze-sample", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { audioBase64, mimeType, knownText } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: "الصوت المطلوب تحليله مفقود" });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "analyze-sample-"));
  try {
    const ext = (mimeType || "").includes("webm") ? "webm" : "wav";
    const filePath = path.join(workDir, `sample.${ext}`);
    await fs.writeFile(filePath, Buffer.from(audioBase64, "base64"));
    const analysis = await analyzeVoiceSample(filePath, knownText || null);
    res.json({ analysis });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.post("/preview-voice", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { text, voiceId, sampleBase64, sampleMimeType, settings, requestKey } = req.body || {};
  const key = requestKey || "default";
  if (busyPreviews.has(key)) return res.status(429).json({ error: "جارٍ توليد عينة سابقة بالفعل، انتظر اكتمالها." });

  if (!text) return res.status(400).json({ error: "نص التجربة مطلوب" });
  // نحدّ نص التجربة لضمان تسجيل 10-15 ثانية تقريبًا كما طُلب، لا حلقة كاملة
  const trimmedText = text.slice(0, 220);

  busyPreviews.add(key);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "preview-"));
  try {
    let finalVoiceId = voiceId;
    if (!finalVoiceId && sampleBase64) {
      let sampleBuffer = Buffer.from(sampleBase64, "base64");
      const rawPath = path.join(workDir, `sample.${(sampleMimeType || "").includes("webm") ? "webm" : "mp3"}`);
      await fs.writeFile(rawPath, sampleBuffer);
      const cleaned = await preprocessSample(rawPath, {
        noiseReduction: settings?.noise_reduction || "off",
        echoRemoval: !!settings?.echo_removal,
      });
      sampleBuffer = await fs.readFile(cleaned);
      finalVoiceId = await cloneVoice({ name: `preview-${Date.now()}`, sampleBuffer, mimeType: sampleMimeType });
    }
    if (!finalVoiceId) return res.status(400).json({ error: "يلزم معرّف صوت أو عينة صوتية للتجربة" });

    const audioBuffer = await textToSpeech({ text: trimmedText, voiceId: finalVoiceId, settings });
    let outPath = path.join(workDir, "preview.mp3");
    await fs.writeFile(outPath, audioBuffer);
    outPath = await applyPitch(outPath, settings?.pitch || 0);
    outPath = await applyLoudnessAndCompression(outPath, { targetLUFS: settings?.target_lufs ?? -16, compress: !!settings?.compress });
    outPath = await applyDeEssing(outPath, !!settings?.de_ess);
    outPath = await applyWarmth(outPath, !!settings?.warmth);
    outPath = await applyPauseLength(outPath, settings?.pause_seconds ?? null);
    const duration = await getDuration(outPath).catch(() => null);
    const finalBuffer = await fs.readFile(outPath);

    res.json({ audioBase64: finalBuffer.toString("base64"), voiceId: finalVoiceId, durationSeconds: duration });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    busyPreviews.delete(key);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

// "تحليل العيّنتين ومطابقتهما" — يقيس فعليًّا ما يمكن قياسه (مستوى الصوت
// بمعيار LUFS الحقيقي)، ويضبط الإعدادات تلقائيًّا بناءً عليه. لا يُعيد أي
// نسبة "تطابق هوية/جرس/نبرة" مختلَقة — هذه الأبعاد تحتاج نموذج تحليل صوت
// متخصّص (بصمة صوتية Speaker Embedding) غير مدمَج في هذا الإصدار، فتبقى
// خارج النتيجة صراحة بدل تزييف رقم لا معنى حقيقي وراءه.
app.post("/analyze-match", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { originalBase64, generatedBase64 } = req.body || {};
  if (!originalBase64 || !generatedBase64) return res.status(400).json({ error: "يلزم الصوتان الأصلي والمُولَّد للتحليل" });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "analyze-"));
  try {
    const origPath = path.join(workDir, "orig.audio");
    const genPath = path.join(workDir, "gen.audio");
    await fs.writeFile(origPath, Buffer.from(originalBase64, "base64"));
    await fs.writeFile(genPath, Buffer.from(generatedBase64, "base64"));

    const [origLUFS, genLUFS, origDur, genDur, origF0, genF0] = await Promise.all([
      measureLoudnessLUFS(origPath), measureLoudnessLUFS(genPath),
      getDuration(origPath).catch(() => null), getDuration(genPath).catch(() => null),
      estimateF0(origPath).catch(() => null), estimateF0(genPath).catch(() => null),
    ]);

    const loudnessDiff = origLUFS != null && genLUFS != null ? Math.abs(origLUFS - genLUFS) : null;
    const loudnessMatchPct = loudnessDiff != null ? Math.max(0, Math.round(100 - loudnessDiff * 8)) : null;

    // مطابقة تقريبية للطبقة الصوتية (النبرة العامة) بالتردد الأساسي الحقيقي
    // المقاس من كلا الصوتين — تقريب حقيقي، لا بصمة هوية متحدث كاملة.
    let pitchMatchPct = null, recommendedPitchPercent = null;
    if (origF0 && genF0) {
      const ratio = origF0 / genF0;
      pitchMatchPct = Math.max(0, Math.round(100 - Math.abs(1 - ratio) * 200));
      recommendedPitchPercent = Math.max(-20, Math.min(20, Math.round((ratio - 1) * 100)));
    }

    res.json({
      measured: {
        original_lufs: origLUFS, generated_lufs: genLUFS,
        original_duration: origDur, generated_duration: genDur,
        original_f0_hz: origF0, generated_f0_hz: genF0,
        loudness_match_pct: loudnessMatchPct,
        pitch_match_pct: pitchMatchPct,
      },
      recommendedSettings: {
        ...(origLUFS != null ? { target_lufs: Math.round(origLUFS) } : {}),
        ...(recommendedPitchPercent != null ? { pitch: recommendedPitchPercent } : {}),
      },
      unmeasurable: ["هوية المتحدث الكاملة (بصمة صوتية بذكاء اصطناعي)", "لون الصوت والجرس التفصيلي", "اللهجة", "العمر الصوتي", "التنفس الطبيعي"],
      note: "المقاسات الحقيقية هنا: مستوى الصوت (LUFS)، المدة، والتردد الأساسي (F0 — مؤشر تقريبي للطبقة الصوتية العامة عبر تحليل ترابط ذاتي حقيقي). هذا ليس بصمة هوية متحدث كاملة — تلك تحتاج نموذج ذكاء اصطناعي متخصّص غير متاح هنا، فلا نعرض لها رقمًا.",
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

// "مطابقة تلقائية" — صادقة الحدود: تضبط التشابه والثبات نحو القيم التي
// توصي بها ElevenLabs نفسها لأقرب استنساخ ممكن. لا تقيس فعليًّا فرق
// الطبقة الصوتية أو الإيقاع بين العيّنة الأصلية والمُولَّد، لأن ذلك يتطلّب
// خوارزمية كشف طبقة صوتية (pitch detection) غير مدمجة بعد — نقول هذا
// صراحة في الاستجابة بدل الادّعاء بمطابقة لا تحدث فعليًّا.
app.post("/auto-match", (req, res) => {
  if (!checkSecret(req, res)) return;
  res.json({
    settings: { similarity_boost: 0.95, stability: 0.5 },
    note: "تم ضبط التشابه والثبات نحو أقرب قيم موصى بها للاستنساخ. مطابقة الطبقة الصوتية والإيقاع تلقائيًّا تحتاج تحليلًا صوتيًّا متقدّمًا غير متاح في هذا الإصدار — اضبطهما يدويًّا بالاستماع للمقارنة، أو استعمل «تحليل العيّنتين ومطابقتهما» لمطابقة مستوى الصوت فعليًّا.",
  });
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`podcast-worker listening on ${PORT}`));

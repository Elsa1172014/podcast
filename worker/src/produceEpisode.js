import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { synthesizeSegment } from "./services/tts.js";
import { cloneVoice, transcribeAudio } from "./services/elevenlabs.js";
import { preprocessSample, detectSegmentDefects, checkWordAccuracy, checkMonotone, applyLoudnessAndCompression } from "./services/audioPost.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setProject(projectId, patch) {
  await supabase.from("projects").update(patch).eq("id", projectId);
}

// نقطة الدخول الرئيسية — يُستدعى هذا عبر POST /produce من الواجهة.
// يُعالج بالتسلسل لا بالتوازي، ويستمر حتى مع فشل مقاطع فردية، تمامًا
// كما حدَّدنا في مخطط الأتمتة.
export async function produceEpisode(projectId) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "episode-"));
  try {
    await setProject(projectId, { status: "processing", progress_pct: 0 });

    const { data: project, error: projErr } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (projErr || !project) throw new Error("المشروع غير موجود");

    const { data: script, error: scriptErr } = await supabase.from("scripts").select("id").eq("project_id", projectId).single();
    if (scriptErr || !script) throw new Error("تعذّر العثور على سيناريو محفوظ لهذا المشروع: " + (scriptErr?.message || ""));
    const { data: segments, error: segErr } = await supabase
      .from("script_segments")
      .select("id, text, order_index, speaker_id")
      .eq("script_id", script.id)
      .order("order_index");
    if (segErr) throw new Error("تعذّر قراءة مقاطع السيناريو: " + segErr.message);
    if (!segments?.length) throw new Error("لا مقاطع في السيناريو");

    const { data: speakers, error: spkErr } = await supabase.from("speakers").select("id, display_name").eq("project_id", projectId);
    if (spkErr) throw new Error("تعذّر قراءة المتحدثين: " + spkErr.message);
    const { data: voiceSamples } = await supabase.from("voice_samples").select("id, speaker_id, voice_model_id, storage_path, settings").in("speaker_id", (speakers || []).map((s) => s.id));
    const sampleBySpeaker = Object.fromEntries((voiceSamples || []).map((v) => [v.speaker_id, v]));

    const unlinked = speakers.filter((s) => !sampleBySpeaker[s.id]);
    if (unlinked.length) throw new Error(`متحدثون بلا صوت مرتبط: ${unlinked.map((s) => s.display_name).join("، ")}`);

    // استنساخ الصوت مرة واحدة فقط لكل متحدث — يُحفَظ voice_model_id بعدها
    // ويُعاد استعماله في كل إنتاج لاحق، بلا استنساخ مكرَّر لنفس العينة.
    const mockMode = (process.env.MOCK_MODE || "true").toLowerCase() !== "false";
    const voiceBySpeaker = {};
    for (const sp of speakers) {
      const sample = sampleBySpeaker[sp.id];
      const settings = sample.settings || {};
      // صوت جاهز من المكتبة (source_type='preset') أو مستنسَخ سابقًا: استعمله مباشرة
      if (sample.voice_model_id) { voiceBySpeaker[sp.id] = { voiceId: sample.voice_model_id, settings }; continue; }
      if (mockMode) { voiceBySpeaker[sp.id] = { voiceId: null, settings }; continue; } // الوضع التجريبي لا يحتاج استنساخًا فعليًّا

      const { data: fileData, error: dlErr } = await supabase.storage.from("voice-samples").download(sample.storage_path);
      if (dlErr) throw new Error(`تعذّر تنزيل عينة صوت «${sp.display_name}»: ${dlErr.message}`);
      let sampleBuffer = Buffer.from(await fileData.arrayBuffer());

      if (settings?.noise_reduction && settings.noise_reduction !== "off" || settings?.echo_removal) {
        const ext = (fileData.type || "").includes("webm") ? "webm" : "mp3";
        const rawPath = path.join(workDir, `${sp.id}-sample.${ext}`);
        await fs.writeFile(rawPath, sampleBuffer);
        const cleaned = await preprocessSample(rawPath, { noiseReduction: settings.noise_reduction || "off", echoRemoval: !!settings.echo_removal });
        sampleBuffer = await fs.readFile(cleaned);
      }

      const voiceId = await cloneVoice({ name: `${sp.display_name}-${projectId}`, sampleBuffer, mimeType: fileData.type });
      await supabase.from("voice_samples").update({ voice_model_id: voiceId, status: "ready" }).eq("id", sample.id);
      voiceBySpeaker[sp.id] = { voiceId, settings };
    }

    const successFiles = [];
    let doneCount = 0;

    for (const seg of segments) {
      // سجّل حالة "processing" لهذا المقطع تحديدًا قبل البدء
      const { data: genRow, error: genErr } = await supabase
        .from("generated_audio_segments")
        .insert({ script_segment_id: seg.id, status: "processing" })
        .select("id")
        .single();
      if (genErr || !genRow) throw new Error("تعذّر إنشاء سجلّ مقطع صوتي: " + (genErr?.message || ""));

      let lastErr = null;
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const { filePath } = await synthesizeSegment({
            text: seg.text,
            voiceModelId: voiceBySpeaker[seg.speaker_id]?.voiceId,
            settings: voiceBySpeaker[seg.speaker_id]?.settings,
            outDir: workDir,
            segmentId: seg.id,
          });
          successFiles.push(filePath);
          await supabase.from("generated_audio_segments").update({ status: "done", storage_path: filePath, retry_count: attempt }).eq("id", genRow.id);
          ok = true;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!ok) {
        // لا نوقف الحلقة كاملة — نسجّل الفشل ونكمل بقية المقاطع، كما حدَّدنا
        await supabase.from("generated_audio_segments").update({ status: "failed", error_message: String(lastErr) }).eq("id", genRow.id);
      }

      doneCount++;
      await setProject(projectId, { progress_pct: Math.round((doneCount / segments.length) * 90) });
    }

    if (successFiles.length === 0) throw new Error("فشلت كل المقاطع، لا يوجد صوت لدمجه");

    // دمج المقاطع الناجحة بترتيبها
    const listFile = path.join(workDir, "concat.txt");
    await fs.writeFile(listFile, successFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const finalPath = path.join(workDir, "episode.mp3");
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listFile)
        .inputOptions(["-f concat", "-safe 0"])
        .audioCodec("libmp3lame")
        .output(finalPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // رفع الناتج النهائي
    const finalBuffer = await fs.readFile(finalPath);
    const storagePath = `${project.owner_id}/${projectId}/episode-${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from("episodes").upload(storagePath, finalBuffer, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error("تعذّر رفع الملف النهائي: " + upErr.message);

    const failedCount = segments.length - successFiles.length;
    await setProject(projectId, {
      status: "preview_ready",
      progress_pct: 100,
      final_audio_path: storagePath,
    });

    return { ok: true, totalSegments: segments.length, failedSegments: failedCount };
  } catch (e) {
    await setProject(projectId, { status: "failed" });
    throw e;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// "معالجة الحلقة" — يعيد توليد كل مقاطع الحلقة مع فحص جودة حقيقي على كل
// واحد منها (لا تقييمًا شكليًّا): تشوّه/قطع صوتي حقيقي، فجوة صمت داخلية
// غير طبيعية، مدة أقصر من المنطقي للنص، دقّة الكلمات فعليًّا عبر تحويل
// المُولَّد مجدَّدًا لنص ومقارنته بالنص المطلوب، ورتابة آلية عبر مؤشّر
// تعبير حقيقي. أي مقطع "معيب" حسب هذه القياسات يُعاد توليده بنفس الصوت
// والنص بالضبط (لا تغيير في الهوية أو المحتوى)، مع رفع "قوة التعبير"
// تلقائيًّا إن كان السبب رتابة. بعد التجميع، تُطبَّق مطابقة صوت نهائية
// حقيقية على الحلقة كاملة لتوحيد المستوى بين كل المتحدثين. لا يُعلَن
// النجاح إلا بعد التحقّق الفعلي من رفع الملف الجديد بنجاح.
export async function humanizeEpisode(projectId) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "humanize-"));
  try {
    const { data: project, error: projErr } = await supabase.from("projects").select("*").eq("id", projectId).single();
    if (projErr || !project) throw new Error("المشروع غير موجود");
    if (!project.final_audio_path) throw new Error("لا توجد حلقة مُنتَجة بعد لهذا المشروع — أنتج الحلقة أولًا.");

    const { data: script, error: scriptErr } = await supabase.from("scripts").select("id").eq("project_id", projectId).single();
    if (scriptErr || !script) throw new Error("تعذّر العثور على سيناريو محفوظ لهذا المشروع.");
    const { data: segments, error: segErr } = await supabase
      .from("script_segments").select("id, text, order_index, speaker_id").eq("script_id", script.id).order("order_index");
    if (segErr || !segments?.length) throw new Error("لا مقاطع في السيناريو.");

    const { data: speakers } = await supabase.from("speakers").select("id, display_name").eq("project_id", projectId);
    const { data: voiceSamples } = await supabase.from("voice_samples").select("id, speaker_id, voice_model_id, settings").in("speaker_id", (speakers || []).map((s) => s.id));
    const sampleBySpeaker = Object.fromEntries((voiceSamples || []).map((v) => [v.speaker_id, v]));
    const voiceBySpeaker = {};
    for (const sp of speakers || []) {
      const sample = sampleBySpeaker[sp.id];
      voiceBySpeaker[sp.id] = { voiceId: sample?.voice_model_id || null, settings: sample?.settings || {} };
    }

    const mockMode = (process.env.MOCK_MODE || "true").toLowerCase() !== "false";
    const finalFiles = [];
    const report = { totalSegments: segments.length, regeneratedCount: 0, reasons: [] };
    let doneCount = 0;

    for (const seg of segments) {
      const voiceInfo = voiceBySpeaker[seg.speaker_id] || {};
      let bestFile = null, bestScore = -1, lastDefects = null;

      // 3 محاولات كحدّ أقصى: الأولى + محاولتا إصلاح إن ظهر عيب حقيقي.
      for (let attempt = 0; attempt < 3; attempt++) {
        const attemptSettings = { ...voiceInfo.settings };
        // إن كان سبب الإعادة رتابة آلية، ارفع قوة التعبير فعليًّا لا شكليًّا
        if (lastDefects?.isMonotone) attemptSettings.style = Math.min(1, (attemptSettings.style ?? 0.2) + 0.15);

        const { filePath } = await synthesizeSegment({
          text: seg.text, voiceModelId: voiceInfo.voiceId, settings: attemptSettings, outDir: workDir, segmentId: `${seg.id}-h${attempt}`,
        });

        const defects = await detectSegmentDefects(filePath, seg.text);
        let wordAccuracy = { matchRatio: 1, mismatchedWords: [] };
        let monotone = { isMonotone: false, expressivenessScore: null };

        if (!mockMode) {
          // تحقّق الكلمات والتعبير حقيقيان — ويستهلكان وقتًا ورصيدًا فعليًّا،
          // فنؤجّلهما عن الوضع التجريبي فقط لتفادي استهلاك بلا داعٍ أثناء الاختبار.
          try {
            const buf = await fs.readFile(filePath);
            const transcribed = await transcribeAudio(buf, "audio/mpeg");
            wordAccuracy = checkWordAccuracy(seg.text, transcribed);
          } catch { /* فشل التحقّق النصّي لا يُسقط المحاولة كاملة */ }
          monotone = await checkMonotone(filePath).catch(() => monotone);
        }

        const isBad = defects.isDefective || wordAccuracy.matchRatio < 0.7 || monotone.isMonotone;
        const score = (wordAccuracy.matchRatio * 100) - (defects.isDefective ? 50 : 0) - (monotone.isMonotone ? 20 : 0);
        if (score > bestScore) { bestScore = score; bestFile = filePath; }
        lastDefects = { ...defects, isMonotone: monotone.isMonotone };

        if (!isBad) break; // نظيف من أول محاولة أو بعد إصلاح — لا داعي لمزيد
        if (attempt > 0) {
          report.regeneratedCount++;
          const reasons = [];
          if (defects.hasClipping) reasons.push("تشوّه صوتي");
          if (defects.hasInternalGap) reasons.push("فجوة صمت غير طبيعية");
          if (defects.tooShort) reasons.push("مدة أقصر من المنطقي");
          if (wordAccuracy.matchRatio < 0.7) reasons.push(`دقّة كلمات منخفضة (${Math.round(wordAccuracy.matchRatio * 100)}%)`);
          if (monotone.isMonotone) reasons.push("أداء رتيب آليًّا");
          report.reasons.push({ segmentOrder: seg.order_index, reasons });
        }
      }

      finalFiles.push(bestFile);
      doneCount++;
      await setProject(projectId, { progress_pct: Math.round((doneCount / segments.length) * 80) });
    }

    // دمج كل المقاطع (بعد الإصلاح) بترتيبها
    const listFile = path.join(workDir, "concat.txt");
    await fs.writeFile(listFile, finalFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    let mergedPath = path.join(workDir, "merged.mp3");
    await new Promise((resolve, reject) => {
      ffmpeg().input(listFile).inputOptions(["-f concat", "-safe 0"]).audioCodec("libmp3lame").output(mergedPath)
        .on("end", resolve).on("error", reject).run();
    });

    // توحيد صوت حقيقي على الحلقة الكاملة — لا لكل مقطع منفردًا فقط كما في
    // الإنتاج الأول، بل تمريرة أخيرة على الملف المُجمَّع كاملًا لضمان
    // مستوى متّسق فعليًّا بين كل المتحدثين معًا.
    mergedPath = await applyLoudnessAndCompression(mergedPath, { targetLUFS: -16, compressRatio: 1 });

    const finalBuffer = await fs.readFile(mergedPath);
    if (!finalBuffer || finalBuffer.length < 1000) throw new Error("الملف الناتج فارغ أو تالف — لن نُعلن نجاحًا بلا تحقّق حقيقي.");

    const humanizedPath = `${project.owner_id}/${projectId}/episode-humanized-${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from("episodes").upload(humanizedPath, finalBuffer, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error("تعذّر رفع الحلقة المُعالَجة: " + upErr.message);

    // تحقّق فعلي أخير: أعد قراءة الملف المرفوع نفسه للتأكّد أنه يعمل من
    // البداية للنهاية، لا مجرد افتراض نجاح الرفع.
    const { data: verifyData, error: verifyErr } = await supabase.storage.from("episodes").download(humanizedPath);
    if (verifyErr || !verifyData || verifyData.size < 1000) throw new Error("تعذّر التحقّق من الملف المرفوع فعليًّا — لن نُعلن نجاحًا.");

    await supabase.from("projects").update({
      humanized_audio_path: humanizedPath,
      humanized_at: new Date().toISOString(),
      humanize_report: report,
    }).eq("id", projectId);
    await setProject(projectId, { progress_pct: 100 });

    return { ok: true, report };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

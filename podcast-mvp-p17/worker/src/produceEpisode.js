import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { synthesizeSegment } from "./services/tts.js";
import { cloneVoice } from "./services/elevenlabs.js";
import { preprocessSample } from "./services/audioPost.js";

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

import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import { textToSpeech } from "./elevenlabs.js";
import { applyPitch, applyLoudnessAndCompression, applyDeEssing, applyPauseLength, applyWarmth } from "./audioPost.js";

ffmpeg.setFfmpegPath(ffmpegPath);

// المدة التقريبية للصوت الوهمي: نصف ثانية لكل عشر أحرف، بحدّ أدنى ثانية
// واحدة — يكفي لاختبار تدفّق الحالات كاملًا بلا أي تكلفة فعلية.
function estimateDuration(text) {
  return Math.max(1, Math.round((text.length / 10) * 0.5));
}

// واجهة موحَّدة: أي مزوّد حقيقي (ElevenLabs) يجب أن يعيد نفس الشكل
// { filePath } ليبقى بقية الكود (الدمج، الرفع) بلا أي تعديل عند التبديل.
export async function synthesizeSegment({ text, voiceModelId, outDir, segmentId, settings }) {
  const mock = (process.env.MOCK_MODE || "true").toLowerCase() !== "false";
  const outPath = path.join(outDir, `${segmentId}.mp3`);

  if (mock) {
    // نولّد الصمت كبيانات PCM خام مباشرة في Node (بلا اعتماد على مصدر lavfi
    // الاصطناعي في ffmpeg، غير المتوفر في بعض نسخ ffmpeg-static المُجمَّعة)،
    // ثم نستعمل ffmpeg فقط للترميز القياسي من PCM إلى MP3.
    const sampleRate = 24000;
    const duration = estimateDuration(text);
    const numSamples = sampleRate * duration;
    const rawPath = path.join(outDir, `${segmentId}.raw`);
    await fs.writeFile(rawPath, Buffer.alloc(numSamples * 2)); // صمت كامل: أصفار 16-bit

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(rawPath)
        .inputOptions(["-f s16le", `-ar ${sampleRate}`, "-ac 1"])
        .audioCodec("libmp3lame")
        .output(outPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
    await fs.unlink(rawPath).catch(() => {});
    return { filePath: outPath, mock: true };
  }

  // التكامل الحقيقي مع ElevenLabs — يتطلّب voiceModelId صالحًا (يُنشَأ عبر
  // استنساخ الصوت أولًا؛ انظر produceEpisode.js حيث يُستدعى ذلك قبل هذه الدالة).
  if (!voiceModelId) throw new Error("لا يوجد صوت مستنسَخ مرتبط بهذا المتحدث بعد.");
  const audioBuffer = await textToSpeech({ text, voiceId: voiceModelId, settings });
  await fs.writeFile(outPath, audioBuffer);
  let tunedPath = outPath;
  tunedPath = await applyPitch(tunedPath, settings?.pitch || 0);
  tunedPath = await applyLoudnessAndCompression(tunedPath, { targetLUFS: settings?.target_lufs ?? -16, compress: !!settings?.compress });
  tunedPath = await applyDeEssing(tunedPath, !!settings?.de_ess);
  tunedPath = await applyWarmth(tunedPath, !!settings?.warmth);
  tunedPath = await applyPauseLength(tunedPath, settings?.pause_seconds ?? null);
  return { filePath: tunedPath, mock: false };
}

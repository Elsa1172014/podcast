// طبقة اتصال حقيقية بـElevenLabs — منفصلة تمامًا عن بقية الكود، بحيث لو
// أردنا استبدال المزوّد يومًا (كما نبّهنا في خطة التنفيذ الأصلية)، هذا هو
// الملف الوحيد الذي يتغيّر.
const BASE = "https://api.elevenlabs.io/v1";

function headers() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY غير مضبوط في متغيّرات بيئة الـWorker.");
  return { "xi-api-key": process.env.ELEVENLABS_API_KEY };
}

// استنساخ فوري (Instant Voice Cloning) — يعمل بعينة قصيرة (أقل من دقيقتين)،
// مناسب لعينات المعلمين المسجَّلة من المتصفح مباشرة.
// خرائط أنواع MIME الشائعة للملفات الصوتية إلى امتداد حقيقي — بعض واجهات
// الرفع البرمجية (بينها ElevenLabs) قد تعتمد على امتداد اسم الملف لا فقط
// ترويسة Content-Type للتعرّف على الصيغة، فاسم عام بلا امتداد صحيح قد
// يُسبّب رفضًا صامتًا لصيغ معيّنة (خصوصًا m4a المرفوعة من الجوّالات).
const EXT_BY_MIME = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/aac": "aac", "audio/flac": "flac",
};

export async function cloneVoice({ name, sampleBuffer, mimeType }) {
  const ext = EXT_BY_MIME[(mimeType || "").toLowerCase()] || "mp3";
  const form = new FormData();
  form.append("name", name);
  form.append("files", new Blob([sampleBuffer], { type: mimeType || "audio/mpeg" }), `sample.${ext}`);

  const res = await fetch(`${BASE}/voices/add`, { method: "POST", headers: headers(), body: form });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`فشل استنساخ الصوت لدى ElevenLabs (${res.status}): ${t}`);
  }
  const data = await res.json();
  if (!data.voice_id) throw new Error("لم يُعِد ElevenLabs معرّف صوت صالحًا.");
  return data.voice_id;
}

// تحويل نص إلى صوت — موديل multilingual_v2 تحديدًا لدعم العربية بجودة
// سردية عالية. كل معامل هنا حقيقي وموثَّق لدى ElevenLabs:
// stability, similarity_boost ("التشابه/الوضوح" — معامل واحد فعليًّا)،
// style ("قوة التعبير والانفعال")، speed (نطاقه الحقيقي 0.7–1.2 فقط)،
// use_speaker_boost ("تعزيز صوت المتحدث").
const DEFAULT_SETTINGS = { stability: 0.55, similarity_boost: 0.9, style: 0.2, speed: 1.0, speaker_boost: true };

export async function textToSpeech({ text, voiceId, settings }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const clampedSpeed = Math.min(1.2, Math.max(0.7, s.speed)); // النطاق الحقيقي الأقصى لدى المزوّد
  const res = await fetch(`${BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: s.stability,
        similarity_boost: s.similarity_boost,
        style: s.style,
        speed: clampedSpeed,
        use_speaker_boost: s.speaker_boost !== false,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`فشل توليد الصوت لدى ElevenLabs (${res.status}): ${t}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// حذف صوت مستنسَخ من حساب ElevenLabs — ضروري لتفادي امتلاء حدّ الأصوات
// المسموح بها (10 في خطة Starter) بسبب تراكم نسخ تجريبية غير معتمَدة.
export async function deleteVoice(voiceId) {
  const res = await fetch(`${BASE}/voices/${voiceId}`, { method: "DELETE", headers: headers() });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`فشل حذف الصوت (${res.status}): ${t}`);
  }
}

// قائمة كل الأصوات المستنسَخة (غير الجاهزة المسبقة) في الحساب — تُستعمل
// في تنظيف النسخ التجريبية غير المستخدَمة.
export async function listClonedVoices() {
  const res = await fetch(`${BASE}/voices?voice_type=personal`, { headers: headers() });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`فشل جلب قائمة الأصوات (${res.status}): ${t}`);
  }
  const data = await res.json();
  return (data.voices || []).map((v) => ({ voiceId: v.voice_id, name: v.name }));
}

// مكتبة الأصوات الجاهزة الحقيقية لدى ElevenLabs — لا نخترع معرّفات، نجلبها
// من واجهتهم البرمجية مباشرة ونعرضها كما هي.
export async function getVoiceLibrary() {
  const res = await fetch(`${BASE}/voices?voice_type=premade`, { headers: headers() });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`فشل جلب مكتبة الأصوات (${res.status}): ${t}`);
  }
  const data = await res.json();
  return (data.voices || []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    description: v.description || v.labels?.description || "",
    gender: v.labels?.gender || "",
    age: v.labels?.age || "",
    previewUrl: v.preview_url || null,
  }));
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabaseClient";

const CONSENT_TEXT = "أقرّ بأنني صاحب هذا الصوت، أو أملك إذنًا صريحًا من صاحبه لاستنساخه واستعماله في هذه المنصة، وأتحمّل المسؤولية الكاملة عن صحة هذا الإقرار.";
const SAMPLE_PARAGRAPH = "أهلًا بكم في حلقة جديدة، نتحدّث فيها عن موضوع شائق نتمنى أن ينال إعجابكم واهتمامكم، ونتمنى لكم استماعًا ممتعًا.";

const DEFAULT_SETTINGS = {
  similarity_boost: 0.9,
  stability: 0.55,
  style: 0.2,          // قوة التعبير 20% — كما طلبت
  speed: 1.0,           // سرعة الكلام 1.00 — كما طلبت
  pitch: 0,              // طبقة الصوت 0% — كما طلبت
  target_lufs: -16,      // مستوى الصوت تلقائي عند -16 LUFS — كما طلبت
  compress: false,
  de_ess: false,
  warmth: false,
  pause_seconds: null,   // null = بلا تعديل على طول الوقفات
  noise_reduction: "light", // كما طلبت
  echo_removal: true,
  speaker_boost: true,
  speaking_style: "conversational",
  auto_match: true,      // «مطابقة الطبقة والسرعة تلقائيًّا» مُفعَّل افتراضيًّا — كما طلبت
};

const STYLE_PRESETS = {
  natural: { label: "طبيعي", style: 0.1, stability: 0.6, speed: 1.0 },
  conversational: { label: "حواري", style: 0.2, stability: 0.55, speed: 1.0 },
  calm: { label: "هادئ", style: 0.1, stability: 0.75, speed: 0.9 },
  excited: { label: "حماسي", style: 0.45, stability: 0.35, speed: 1.1 },
  formal: { label: "رسمي", style: 0.05, stability: 0.8, speed: 0.95 },
  narrative: { label: "قصصي", style: 0.3, stability: 0.5, speed: 0.95 },
};

export default function VoicesPage() {
  const { id } = useParams();
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [speakers, setSpeakers] = useState([]);
  const [samples, setSamples] = useState({});
  const [loading, setLoading] = useState(true);
  const [openFor, setOpenFor] = useState(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) return router.replace("/login");
      setSession(s);

      const { data: sp } = await supabase.from("speakers").select("*").eq("project_id", id).order("created_at");
      setSpeakers(sp || []);

      if (sp?.length) {
        const { data: vs } = await supabase.from("voice_samples").select("*").in("speaker_id", sp.map((x) => x.id));
        const bySpeaker = {};
        (vs || []).forEach((v) => { bySpeaker[v.speaker_id] = v; });
        setSamples(bySpeaker);
      }
      setLoading(false);
    })();
  }, [id, router]);

  const allLinked = speakers.length > 0 && speakers.every((s) => samples[s.id]?.is_approved);
  const [cleanupMsg, setCleanupMsg] = useState("");
  const [cleaning, setCleaning] = useState(false);

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;

  const cleanupVoices = async () => {
    setCleaning(true); setCleanupMsg("");
    const res = await fetch("/api/cleanup-voices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const data = await res.json();
    setCleaning(false);
    if (!res.ok) return setCleanupMsg("تعذّر التنظيف: " + data.error);
    setCleanupMsg(`حُذف ${data.deletedCount} صوتًا تجريبيًّا غير مستخدَم — تبقّى ${data.keptApproved} صوتًا معتمَدًا محفوظًا.`);
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push(`/project/${id}/script`)} style={{ background: "none", border: "none", color: "#5B6F6C", cursor: "pointer", marginBottom: 12, padding: 0 }}>→ العودة للسيناريو</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>ربط الأصوات بالمتحدثين</h1>
          <p style={{ color: "#5B6F6C", marginBottom: 8 }}>لكل متحدث: استنسخ صوتًا (رفع أو تسجيل) أو اختر صوتًا جاهزًا، ثم قارن الصوت المُولَّد بالأصلي واضبطه قبل الاعتماد النهائي.</p>
        </div>
        <button disabled={cleaning} onClick={cleanupVoices} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #A6402F", background: "#fff", color: "#A6402F", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          {cleaning ? "جارٍ التنظيف…" : "🧹 تنظيف الأصوات التجريبية غير المستخدمة"}
        </button>
      </div>
      {cleanupMsg && <p style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 16 }}>{cleanupMsg}</p>}

      {speakers.length === 0 && <div style={{ padding: 24, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF", color: "#5B6F6C" }}>لا متحدثون مكتشَفون بعد. عد لصفحة السيناريو أولًا.</div>}

      {speakers.map((sp) => (
        <SpeakerRow key={sp.id} speaker={sp} sample={samples[sp.id]} session={session} projectId={id}
          open={openFor === sp.id} onToggle={() => setOpenFor(openFor === sp.id ? null : sp.id)}
          onSaved={(row) => setSamples((prev) => ({ ...prev, [sp.id]: row }))} />
      ))}

      {speakers.length > 0 && (
        <button disabled={!allLinked} onClick={() => router.push(`/project/${id}/produce`)}
          style={{ marginTop: 20, padding: "12px 24px", borderRadius: 8, border: "none",
            background: allLinked ? "#14201E" : "#DCE4DF", color: allLinked ? "#fff" : "#9AA6A3",
            fontSize: 15, fontWeight: 600, cursor: allLinked ? "pointer" : "not-allowed" }}>
          {allLinked ? "التالي: إنتاج الحلقة ←" : `اعتمد صوتًا لكل متحدث أولًا (${Object.values(samples).filter((s) => s?.is_approved).length}/${speakers.length})`}
        </button>
      )}
    </div>
  );
}

function statusLabel(s) {
  return { pending: "بانتظار المعالجة", processing: "جارٍ المعالجة", uploading: "جارٍ الرفع", cloning: "جارٍ الاستنساخ", generating: "جارٍ التوليد", ready: "جاهز", failed: "فشلت المعالجة" }[s] || s;
}

function SpeakerRow({ speaker, sample, session, projectId, open, onToggle, onSaved }) {
  return (
    <div style={{ marginBottom: 14, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{speaker.display_name}</div>
          <div style={{ fontSize: 13, color: sample?.is_approved ? "#14746F" : "#A6402F" }}>
            {sample ? `${{ upload: "رفع ملف", record: "تسجيل مباشر", preset: "من المكتبة الجاهزة" }[sample.source_type] || sample.source_type} — ${sample.is_approved ? "مُعتمَد ✓" : "لم يُعتمَد بعد"} — ${statusLabel(sample.status)}` : "لم يُربط صوت بعد"}
          </div>
        </div>
        <button onClick={onToggle} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #DCE4DF", background: "#fff", cursor: "pointer" }}>
          {open ? "إغلاق" : sample ? "تعديل الصوت" : "أضف صوتًا"}
        </button>
      </div>
      {open && <VoiceStudio speaker={speaker} sample={sample} session={session} projectId={projectId} onSaved={(row) => { onSaved(row); }} />}
    </div>
  );
}

function VoiceStudio({ speaker, sample, session, projectId, onSaved }) {
  const [mode, setMode] = useState("upload");
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [agree, setAgree] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const [settings, setSettings] = useState(sample?.settings || DEFAULT_SETTINGS);
  const [lastSaved] = useState(sample?.settings || DEFAULT_SETTINGS);
  const [testText, setTestText] = useState(SAMPLE_PARAGRAPH);

  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const [testedVoiceId, setTestedVoiceId] = useState(sample?.voice_model_id || null);
  const [generatedAudio, setGeneratedAudio] = useState(null);
  const [genDuration, setGenDuration] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [origDuration, setOrigDuration] = useState(null);

  const origRef = useRef(null);
  const genRef = useRef(null);
  const [approving, setApproving] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [matchNote, setMatchNote] = useState("");

  const [library, setLibrary] = useState(null);
  const [libraryErr, setLibraryErr] = useState("");
  const loadLibrary = async () => {
    setLibraryErr("");
    const res = await fetch("/api/voice-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const data = await res.json();
    if (!res.ok) return setLibraryErr(data.error || "تعذّر جلب المكتبة");
    setLibrary(data.voices || []);
  };

  // حمِّل العيّنة الأصلية المحفوظة (إن وُجدت) عند فتح صوت مرتبط سابقًا —
  // بدونها لا يمكن مقارنته بالمُولَّد الجديد إطلاقًا.
  useEffect(() => {
    if (!sample?.storage_path) return;
    const supabase = createClient();
    supabase.storage.from("voice-samples").createSignedUrl(sample.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setOriginalUrl(data.signedUrl);
    });
  }, [sample?.storage_path]);

  useEffect(() => {
    const o = origRef.current, g = genRef.current;
    if (!o || !g) return;
    const pauseOther = (self, other) => () => other && other.pause();
    o.addEventListener("play", pauseOther(o, g));
    g.addEventListener("play", pauseOther(g, o));
    return () => { o?.removeEventListener("play", pauseOther); g?.removeEventListener("play", pauseOther); };
  }, [originalUrl, generatedAudio]);

  const playSequential = async () => {
    if (!origRef.current || !genRef.current) return;
    origRef.current.currentTime = 0; genRef.current.currentTime = 0;
    origRef.current.play();
    origRef.current.onended = () => genRef.current.play();
  };

  const startRecording = async () => {
    setErr(""); setRecordedBlob(null); setTestedVoiceId(null); setGeneratedAudio(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        setOriginalUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      setErr("تعذّر الوصول للميكروفون. تأكّد من السماح للمتصفح بالوصول إليه.");
    }
  };
  const stopRecording = () => { mediaRef.current?.stop(); setRecording(false); };

  useEffect(() => {
    if (mode === "upload" && file) setOriginalUrl(URL.createObjectURL(file));
  }, [file, mode]);

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const generateTrial = async (settingsOverride) => {
    const activeSettings = settingsOverride || settings;
    const blob = mode === "upload" ? file : recordedBlob;
    if (!blob && !testedVoiceId) return setErr(mode === "upload" ? "اختر ملفًا أولًا." : "سجّل صوتًا أولًا.");
    if (!agree) return setErr("يجب تأكيد امتلاكك موافقة صاحب الصوت قبل الاستنساخ.");
    if (status === "uploading" || status === "cloning" || status === "generating") return;

    setErr(""); setGeneratedAudio(null);
    try {
      const body = { text: testText, settings: activeSettings, requestKey: `${speaker.id}` };
      if (testedVoiceId) {
        setStatus("generating");
        body.voiceId = testedVoiceId;
      } else {
        setStatus("uploading");
        body.sampleBase64 = await blobToBase64(blob);
        body.sampleMimeType = blob.type;
        setStatus("cloning");
      }
      const res = await fetch("/api/preview-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, accessToken: session.access_token }) });
      setStatus("generating");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestedVoiceId(data.voiceId);
      setGeneratedAudio(`data:audio/mpeg;base64,${data.audioBase64}`);
      setGenDuration(data.durationSeconds);
      setStatus("success");
      return true;
    } catch (e) {
      setErr("تعذّر التوليد: " + e.message);
      setStatus("failed");
      return false;
    }
  };

  const autoMatch = async () => {
    setAutoMatching(true); setErr("");
    const res = await fetch("/api/auto-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const data = await res.json();
    if (!res.ok) { setAutoMatching(false); return setErr(data.error || "تعذّرت المطابقة"); }
    const merged = { ...settings, ...data.settings };
    setSettings(merged);
    // أعِد التوليد فورًا بالإعدادات الجديدة — لتسمع أثر المطابقة فعليًّا،
    // لا مجرد أرقام تغيّرت بصمت في اللوحة.
    await generateTrial(merged);
    setAutoMatching(false);
    setErr("");
    setMatchNote(data.note);
  };

  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzeAndMatch = async () => {
    if (!generatedAudio) return setErr("ولّد عينة تجريبية أولًا.");
    const origBlob = mode === "upload" ? file : recordedBlob;
    if (!origBlob && !originalUrl) return setErr("لا عيّنة أصلية متاحة للمقارنة.");
    setAnalyzing(true); setErr("");
    try {
      const originalBase64 = origBlob ? await blobToBase64(origBlob) : await (async () => {
        const r = await fetch(originalUrl); const b = await r.blob(); return blobToBase64(b);
      })();
      const generatedBase64 = generatedAudio.split(",")[1];
      const res = await fetch("/api/analyze-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalBase64, generatedBase64, accessToken: session.access_token }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data);
      if (settings.auto_match && data.recommendedSettings && Object.keys(data.recommendedSettings).length) {
        const merged = { ...settings, ...data.recommendedSettings };
        setSettings(merged);
        // نفس مبدأ "مطابقة تلقائية": التحليل بلا إعادة توليد فوري يبقى
        // مجرّد أرقام — هنا نُثبت المطابقة بصوت حقيقي مسموع مباشرة.
        await generateTrial(merged);
      }
    } catch (e) {
      setErr("تعذّر التحليل: " + e.message);
    }
    setAnalyzing(false);
  };

  const resetDefaults = () => setSettings(DEFAULT_SETTINGS);
  const cancelChanges = () => setSettings(lastSaved);

  const approve = async (presetVoice) => {
    setApproving(true); setErr("");
    const supabase = createClient();

    if (presetVoice) {
      const { data: row, error: insErr } = await supabase.from("voice_samples").insert({
        speaker_id: speaker.id, storage_path: null, source_type: "preset",
        voice_model_id: presetVoice.voiceId, status: "ready", settings, is_approved: true, voice_name: presetVoice.name,
      }).select("*").single();
      setApproving(false);
      if (insErr) return setErr(insErr.message);
      return onSaved(row);
    }

    if (!testedVoiceId) { setApproving(false); return setErr("جرّب الصوت أولًا قبل الاعتماد."); }
    const blob = mode === "upload" ? file : recordedBlob;

    if (blob) {
      const consentRes = await fetch("/api/consent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentText: CONSENT_TEXT, accessToken: session.access_token }),
      });
      const consentData = await consentRes.json();
      if (!consentRes.ok) { setApproving(false); return setErr("تعذّر تسجيل الموافقة: " + consentData.error); }

      const ext = mode === "upload" ? (file.name.split(".").pop() || "mp3") : "webm";
      const path = `${session.user.id}/${projectId}/${speaker.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("voice-samples").upload(path, blob, { upsert: true });
      if (upErr) { setApproving(false); return setErr("تعذّر رفع الملف: " + upErr.message); }

      const { data: row, error: insErr } = await supabase.from("voice_samples").insert({
        speaker_id: speaker.id, storage_path: path, source_type: mode,
        consent_id: consentData.consentId, voice_model_id: testedVoiceId,
        status: "ready", settings, is_approved: true,
      }).select("*").single();
      setApproving(false);
      if (insErr) return setErr(insErr.message);
      return onSaved(row);
    }

    const { data: row, error: updErr } = await supabase.from("voice_samples").update({ settings, voice_model_id: testedVoiceId, is_approved: true, status: "ready" }).eq("id", sample.id).select("*").single();
    setApproving(false);
    if (updErr) return setErr(updErr.message);
    onSaved(row);
  };

  const processing = ["uploading", "cloning", "generating"].includes(status);
  const showCapture = !sample?.voice_model_id || replacing;

  return (
    <div style={{ padding: 16, borderTop: "1px solid #DCE4DF", background: "#F9FAF9" }}>
      {sample?.voice_model_id && !replacing && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#EAF3F1", borderRadius: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: "#14201E" }}>لديك صوت مرتبط بالفعل بهذا المتحدث.</span>
          <button onClick={() => {
            // احذف النسخة القديمة غير المعتمَدة قبل البدء من جديد — تفادي
            // تراكم أصوات تجريبية تستهلك حدّ ElevenLabs بلا داعٍ.
            if (sample?.voice_model_id && !sample?.is_approved) {
              fetch("/api/delete-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token, voiceId: sample.voice_model_id }) }).catch(() => {});
            }
            setReplacing(true); setTestedVoiceId(null); setGeneratedAudio(null); setOriginalUrl(null);
          }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>استبدال بصوت جديد</button>
        </div>
      )}

      {showCapture && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={() => setMode("upload")} style={tabBtn(mode === "upload")}>رفع ملف</button>
          <button onClick={() => setMode("record")} style={tabBtn(mode === "record")}>تسجيل مباشر</button>
          <button onClick={() => { setMode("library"); if (!library) loadLibrary(); }} style={tabBtn(mode === "library")}>مكتبة جاهزة</button>
        </div>
      )}

      {mode === "library" && showCapture ? (
        <VoiceLibraryPicker library={library} error={libraryErr} onPick={(v) => approve(v)} busy={approving} />
      ) : (
        <>
          {showCapture && (mode === "upload" ? (
            <>
              <input type="file" accept="audio/*" onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f && f.size === 0) { setErr("الملف المختار فارغ (0 بايت) — اختر ملفًا آخر."); return; }
                if (f && !f.type.startsWith("audio/")) { setErr("هذا ليس ملفًّا صوتيًّا مدعومًا. الصيغ المدعومة: MP3, WAV, M4A, OGG, WEBM."); return; }
                setErr("");
                setFile(f); setTestedVoiceId(null); setGeneratedAudio(null);
              }} style={{ marginBottom: 10 }} />
              {file && (
                <div style={{ marginBottom: 14, padding: 10, background: "#fff", borderRadius: 8, border: "1px solid #DCE4DF" }}>
                  <div style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 6 }}>تحقّق من الملف قبل المتابعة: {file.name} ({(file.size / 1024).toFixed(0)} كيلوبايت)</div>
                  <audio controls src={URL.createObjectURL(file)} style={{ width: "100%" }} />
                </div>
              )}
            </>
          ) : mode === "record" ? (
            <div style={{ marginBottom: 14 }}>
              {!recording ? (
                <button onClick={startRecording} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#A6402F", color: "#fff", cursor: "pointer" }}>● ابدأ التسجيل</button>
              ) : (
                <button onClick={stopRecording} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", cursor: "pointer" }}>■ أوقف التسجيل</button>
              )}
            </div>
          ) : null)}

          {showCapture && mode !== "library" && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
              <span>أؤكّد أنني أملك موافقة صاحب هذا الصوت على استنساخه — {CONSENT_TEXT}</span>
            </label>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>نص التجربة (10–15 ثانية تقريبًا)</label>
            <textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={2} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #DCE4DF", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button disabled={processing} onClick={() => generateTrial()} style={btnPrimary}>
              {processing ? statusLabel(status) + "…" : "توليد عينة تجريبية"}
            </button>
            <button disabled={!generatedAudio || autoMatching} onClick={autoMatch} style={btnOutline}>{autoMatching ? "جارٍ المطابقة…" : "مطابقة تلقائية"}</button>
            <button disabled={!generatedAudio || analyzing} onClick={analyzeAndMatch} style={{ ...btnOutline, borderColor: "#C99A2E", color: "#8A6D1F" }}>{analyzing ? "جارٍ التحليل…" : "🔬 تحليل العيّنتين ومطابقتهما"}</button>
            <button onClick={resetDefaults} style={btnGhost}>استعادة الإعدادات الافتراضية</button>
            <button onClick={cancelChanges} style={btnGhost}>إلغاء التعديلات</button>
          </div>

          {err && <div style={{ color: "#A6402F", fontSize: 13, marginBottom: 14 }}>{err} {status === "failed" && <button onClick={() => generateTrial()} style={{ marginRight: 8, color: "#14746F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>أعد المحاولة</button>}</div>}
          {matchNote && <div style={{ color: "#5B6F6C", fontSize: 12, marginBottom: 14 }}>ℹ️ {matchNote}</div>}

          {(originalUrl || generatedAudio) && (
            <div style={{ padding: 14, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF", marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 15 }}>مقارنة الصوت وضبطه</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 4 }}>العيّنة الأصلية {origDuration ? `— ${origDuration.toFixed(1)} ثانية` : ""}</div>
                  {originalUrl ? <audio ref={origRef} controls src={originalUrl} onLoadedMetadata={(e) => setOrigDuration(e.target.duration)} style={{ width: "100%" }} /> : <div style={{ fontSize: 12, color: "#9AA6A3" }}>غير متاحة</div>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 4 }}>الصوت المُولَّد {genDuration ? `— ${Number(genDuration).toFixed(1)} ثانية` : ""}</div>
                  {generatedAudio ? <audio ref={genRef} controls src={generatedAudio} style={{ width: "100%" }} /> : <div style={{ fontSize: 12, color: "#9AA6A3" }}>لم يُولَّد بعد</div>}
                </div>
              </div>
              {originalUrl && generatedAudio && (
                <button onClick={playSequential} style={{ ...btnOutline, marginBottom: 4 }}>▶ تشغيل الاثنين بالتتابع للمقارنة</button>
              )}
              {analysis && (
                <div style={{ marginTop: 14, padding: 12, background: "#FBF6E8", borderRadius: 8, border: "1px solid #E8D8A8" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>نتيجة التحليل الحقيقي</div>
                  {analysis.measured.loudness_match_pct != null && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>🔊 تطابق مستوى الصوت: <strong>{analysis.measured.loudness_match_pct}%</strong> (الأصلي {analysis.measured.original_lufs?.toFixed(1)} LUFS، المُولَّد {analysis.measured.generated_lufs?.toFixed(1)} LUFS)</div>
                  )}
                  {analysis.measured.pitch_match_pct != null && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>🎵 تقريب تطابق الطبقة الصوتية: <strong>{analysis.measured.pitch_match_pct}%</strong> (الأصلي ~{analysis.measured.original_f0_hz?.toFixed(0)}Hz، المُولَّد ~{analysis.measured.generated_f0_hz?.toFixed(0)}Hz)</div>
                  )}
                  <p style={{ fontSize: 11, color: "#9AA6A3", margin: "8px 0 0" }}>{analysis.note}</p>
                </div>
              )}
            </div>
          )}

          <VoiceSettingsPanel settings={settings} onChange={setSettings} />

          <button disabled={approving} onClick={() => approve(null)} style={{ ...btnPrimary, marginTop: 16 }}>
            {approving ? "جارٍ الاعتماد…" : "اعتماد الصوت"}
          </button>
        </>
      )}
    </div>
  );
}

// حلقتا تقدّم دائريتان للمعاملين الأهمّ (التشابه والثبات) — تُبنى بحيلة
// conic-gradient البسيطة، بلا حاجة لمكتبة رسم إضافية.
function RingStat({ value, label, color }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 84, height: 84, borderRadius: "50%",
        background: `conic-gradient(${color} ${pct * 3.6}deg, #E7ECEA 0deg)`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: 66, height: 66, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color }}>{pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#14201E" }}>{label}</span>
    </div>
  );
}

function GradientSlider({ icon, label, value, min, max, step, onChange, fmt, color = "#14746F" }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{icon} {label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, background: `${color}17`, padding: "2px 10px", borderRadius: 12 }}>{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} className="tuner-slider"
        style={{ background: `linear-gradient(to left, ${color} ${pct}%, #E7ECEA ${pct}%)` }} />
    </div>
  );
}

function VoiceSettingsPanel({ settings, onChange }) {
  const set = (key) => (e) => onChange({ ...settings, [key]: parseFloat(e.target.value) });
  return (
    <div style={{ padding: 18, background: "linear-gradient(180deg, #FBFDFC, #fff)", borderRadius: 14, border: "1px solid #DCE4DF" }}>
      <style>{`
        .tuner-slider { -webkit-appearance: none; width: 100%; height: 6px; border-radius: 6px; outline: none; }
        .tuner-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 3px solid #14746F; box-shadow: 0 2px 6px rgba(20,116,111,.4); cursor: pointer; }
        .tuner-slider::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 3px solid #14746F; cursor: pointer; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>🎛️ استوديو ضبط الصوت</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#5B6F6C" }}>مطابقة مستوى الصوت تلقائيًّا</span>
          <div onClick={() => onChange({ ...settings, auto_match: !settings.auto_match })} style={{ width: 36, height: 20, borderRadius: 12, background: settings.auto_match ? "#14746F" : "#DCE4DF", position: "relative", cursor: "pointer" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, [settings.auto_match ? "right" : "left"]: 2 }} />
          </div>
        </div>
      </div>

      {/* لوحة الدقّة الرئيسية — حلقتان دائريتان */}
      <div style={{ display: "flex", gap: 20, justifyContent: "center", padding: "10px 0 18px", borderBottom: "1px dashed #DCE4DF", marginBottom: 16 }}>
        <RingStat value={settings.similarity_boost} label="التشابه والوضوح" color="#14746F" />
        <RingStat value={settings.stability} label="ثبات الصوت" color="#A6402F" />
      </div>
      <p style={{ fontSize: 11, color: "#9AA6A3", marginTop: -10, marginBottom: 16, textAlign: "center" }}>"التشابه" و"الوضوح" معامل واحد فعليًّا لدى المزوّد، و"طبيعية الأداء" مندمجة في "الثبات" — لا تكرار وهمي لمعاملات غير موجودة.</p>

      {/* بطاقة: الأداء والتعبير */}
      <div style={{ padding: 14, background: "#F5F8F7", borderRadius: 12, marginBottom: 14, borderRight: "4px solid #14746F" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#14746F", marginBottom: 10 }}>🎭 الأداء والتعبير</div>
        <GradientSlider icon="✨" label="قوة التعبير والانفعال" value={settings.style} min={0} max={1} step={0.01} onChange={set("style")} fmt={(v) => `${Math.round(v * 100)}%`} />
        <GradientSlider icon="⏱️" label="سرعة الكلام" value={settings.speed} min={0.7} max={1.2} step={0.01} onChange={set("speed")} fmt={(v) => v.toFixed(2)} />
      </div>

      {/* بطاقة: الجودة الصوتية */}
      <div style={{ padding: 14, background: "#F5F8F7", borderRadius: 12, marginBottom: 14, borderRight: "4px solid #A6402F" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#A6402F", marginBottom: 10 }}>🎚️ الجودة الصوتية</div>
        <GradientSlider icon="🎵" label="طبقة الصوت" value={settings.pitch} min={-20} max={20} step={1} onChange={set("pitch")} fmt={(v) => `${v > 0 ? "+" : ""}${v}%`} color="#A6402F" />
        <GradientSlider icon="🔊" label="مستوى الصوت المستهدف (LUFS، معيار البودكاست الاحترافي)" value={settings.target_lufs} min={-30} max={-9} step={1} onChange={set("target_lufs")} fmt={(v) => `${v} LUFS`} color="#A6402F" />
        <GradientSlider icon="⏸️" label="طول الوقفات بين الجمل" value={settings.pause_seconds ?? 0.4} min={0.1} max={1.5} step={0.05} onChange={(e) => onChange({ ...settings, pause_seconds: parseFloat(e.target.value) })} fmt={(v) => `${v.toFixed(2)} ثا`} color="#A6402F" />
        <ToggleRow label="ضغط الصوت (توحيد الديناميكية)" checked={settings.compress} onChange={(v) => onChange({ ...settings, compress: v })} />
        <ToggleRow label="تخفيف الصفير (تقريبي)" checked={settings.de_ess} onChange={(v) => onChange({ ...settings, de_ess: v })} />
        <ToggleRow label="🔥 الدفء الصوتي" checked={settings.warmth} onChange={(v) => onChange({ ...settings, warmth: v })} />
      </div>

      {/* بطاقة: التنقية */}
      <div style={{ padding: 14, background: "#F5F8F7", borderRadius: 12, marginBottom: 14, borderRight: "4px solid #7A8B87" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#5B6F6C", marginBottom: 10 }}>🧹 تنقية العيّنة المصدر</div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>تقليل الضوضاء</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["off", "متوقف"], ["light", "خفيف"], ["medium", "متوسط"], ["strong", "قوي"]].map(([k, l]) => (
              <button key={k} onClick={() => onChange({ ...settings, noise_reduction: k })}
                style={{ padding: "6px 14px", borderRadius: 16, border: "1px solid #DCE4DF", cursor: "pointer", fontSize: 12,
                  background: settings.noise_reduction === k ? "#5B6F6C" : "#fff", color: settings.noise_reduction === k ? "#fff" : "#14201E" }}>{l}</button>
            ))}
          </div>
        </div>
        <ToggleRow label="إزالة الصدى (تقريبية)" checked={settings.echo_removal} onChange={(v) => onChange({ ...settings, echo_removal: v })} />
        <p style={{ fontSize: 11, color: "#9AA6A3", margin: "-4px 0 8px" }}>حدّ تقني: لا تتوفّر إزالة صدى حقيقية بلا نموذج ذكاء اصطناعي متخصّص؛ هذا مرشّح تقريبي فقط.</p>
        <ToggleRow label="تعزيز صوت المتحدث" checked={settings.speaker_boost} onChange={(v) => onChange({ ...settings, speaker_boost: v })} />
      </div>

      {/* بطاقة: أسلوب الأداء */}
      <div style={{ padding: 14, background: "#F5F8F7", borderRadius: 12, borderRight: "4px solid #C99A2E" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#8A6D1F", marginBottom: 10 }}>🎬 أسلوب الأداء</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(STYLE_PRESETS).map(([key, preset]) => (
            <button key={key} onClick={() => onChange({ ...settings, speaking_style: key, style: preset.style, stability: preset.stability, speed: preset.speed })}
              style={{ padding: "8px 16px", borderRadius: 18, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: settings.speaking_style === key ? "linear-gradient(135deg, #14746F, #0E3A40)" : "#fff",
                color: settings.speaking_style === key ? "#fff" : "#14201E",
                boxShadow: settings.speaking_style === key ? "0 3px 10px rgba(20,116,111,.35)" : "0 1px 3px rgba(0,0,0,.08)" }}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "#9AA6A3", marginTop: 14, lineHeight: 1.8 }}>
        ✅ أُضيف حديثًا: "الدفء الصوتي" (تعزيز EQ حقيقي)، و"مطابقة النبرة" كتقريب حقيقي عبر قياس التردد الأساسي (F0) فعليًّا من الصوتين — يظهر بعد الضغط على «تحليل العيّنتين ومطابقتهما»، وليس بصمة هوية متحدث كاملة.
        <br />
        🔒 ما زال خارج النطاق بصدق: هوية المتحدث الكاملة (تحتاج نموذج بصمة صوتية بذكاء اصطناعي)، لون الصوت والجرس التفصيلي، اللهجة، العمر الصوتي، التنفس الطبيعي — هذه تتطلّب نموذج تحليل/تركيب صوت متخصّص إضافيًّا غير مدمَج بعد.
      </p>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: 6 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <div style={{ width: 40, height: 22, borderRadius: 12, background: checked ? "#14746F" : "#DCE4DF", position: "relative", transition: "background .2s" }}>
        <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, [checked ? "right" : "left"]: 2, transition: "all .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
      </div>
    </div>
  );
}


function VoiceLibraryPicker({ library, error, onPick, busy }) {
  if (error) return <div style={{ color: "#A6402F", fontSize: 13 }}>{error}</div>;
  if (!library) return <div style={{ color: "#5B6F6C", fontSize: 13 }}>جارٍ تحميل المكتبة…</div>;
  if (!library.length) return <div style={{ color: "#5B6F6C", fontSize: 13 }}>لا أصوات جاهزة متاحة على حسابك حاليًا.</div>;
  return (
    <div style={{ display: "grid", gap: 10, maxHeight: 360, overflowY: "auto" }}>
      {library.map((v) => (
        <div key={v.voiceId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#fff", borderRadius: 8, border: "1px solid #DCE4DF" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{v.name}</div>
            <div style={{ fontSize: 12, color: "#5B6F6C" }}>{[v.gender, v.age, v.description].filter(Boolean).join(" — ")}</div>
            {v.previewUrl && <audio controls src={v.previewUrl} style={{ height: 28, marginTop: 6 }} />}
          </div>
          <button disabled={busy} onClick={() => onPick(v)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontWeight: 600, cursor: "pointer" }}>اختر</button>
        </div>
      ))}
    </div>
  );
}

const tabBtn = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "1px solid #DCE4DF", cursor: "pointer", background: active ? "#14746F" : "#fff", color: active ? "#fff" : "#14201E" });
const btnPrimary = { padding: "10px 20px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontWeight: 600, cursor: "pointer" };
const btnOutline = { padding: "10px 20px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "10px 16px", borderRadius: 8, border: "1px solid #DCE4DF", background: "#fff", color: "#5B6F6C", cursor: "pointer" };

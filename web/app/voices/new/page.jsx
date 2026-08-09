"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabaseClient";
import DualCircleControl from "../../../lib/DualCircleControl";

const CONSENT_TEXT = "أقرّ بأنني صاحب هذا الصوت، أو أملك إذنًا صريحًا من صاحبه لاستنساخه واستعماله في هذه المنصة، وأتحمّل المسؤولية الكاملة عن صحة هذا الإقرار.";
const AGE_STAGES = ["طفل", "طالب ابتدائي", "طالب متوسط", "طالب ثانوي", "شاب", "بالغ", "كبير السن"];

// خاصيات حقيقية قابلة للمقارنة مباشرة (رقمية) — لكل واحدة وحدتها ووزنها
// النسبي في حساب "نسبة التطابق الكلية". الخاصيات "غير المتاحة" (هوية،
// لهجة، انفعال...) لا تدخل هذا الحساب لأنها غير مقيسة أصلًا — لا نموّه
// رقمًا كليًّا بإدراج تقديرات وهمية ضمنه.
const COMPARABLE = [
  { key: "loudness_lufs", label: "مستوى الصوت", unit: "LUFS", tolerance: 6 },
  { key: "pitch_hz", label: "طبقة الصوت", unit: "Hz", tolerance: 40 },
  { key: "jitter_pct", label: "اهتزاز التردد (Jitter)", unit: "%", tolerance: 3 },
  { key: "hnr_db", label: "نقاء الصوت (HNR)", unit: "dB", tolerance: 10 },
  { key: "dynamic_range_db", label: "المدى الديناميكي", unit: "dB", tolerance: 8 },
  { key: "warmth_pct", label: "دفء الصوت", unit: "%", tolerance: 25 },
];

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  if (!magA || !magB) return null;
  return Math.round(Math.max(0, Math.min(1, dot / (Math.sqrt(magA) * Math.sqrt(magB)))) * 1000) / 10;
}

function computeMatch(orig, gen) {
  if (!orig || !gen) return null;
  const rows = [];
  let totalPct = 0, count = 0;
  for (const c of COMPARABLE) {
    const ov = orig[c.key], gv = gen[c.key];
    if (typeof ov !== "number" || typeof gv !== "number") {
      rows.push({ ...c, original: ov, generated: gv, matchPct: null });
      continue;
    }
    const diff = Math.abs(ov - gv);
    const pct = Math.max(0, Math.min(100, Math.round(100 - (diff / c.tolerance) * 100)));
    rows.push({ ...c, original: ov, generated: gv, matchPct: pct });
    totalPct += pct; count++;
  }
  // التشابه الطيفي (بديل صادق لـ"بصمة المتحدث" الكاملة — تقريب حقيقي عبر
  // مقارنة توزيع الطاقة عبر 5 نطاقات ترددية، لا نموذج ذكاء اصطناعي).
  const spectralPct = cosineSim(orig.spectral_profile, gen.spectral_profile);
  if (spectralPct != null) {
    rows.unshift({ key: "spectral_similarity", label: "التشابه الطيفي (تقريب لبصمة الصوت)", unit: "%", original: null, generated: null, matchPct: spectralPct });
    totalPct += spectralPct; count++;
  }
  return { rows, overallPct: count ? Math.round(totalPct / count) : null };
}

export default function NewStandaloneVoice() {
  const router = useRouter();
  const [session, setSession] = useState(null);

  const [ownerName, setOwnerName] = useState("");
  const [ageStage, setAgeStage] = useState(AGE_STAGES[1]);
  const [description, setDescription] = useState("");
  const [agree, setAgree] = useState(false);

  const [mode, setMode] = useState("upload");
  const [file, setFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const [status, setStatus] = useState("idle"); // idle | uploading | analyzing | analyzed | needs_improvement | failed | cloning | generating | success
  const [err, setErr] = useState("");
  const [origAnalysis, setOrigAnalysis] = useState(null);
  const [genAnalysis, setGenAnalysis] = useState(null);
  const [voiceId, setVoiceId] = useState(null);
  const [consentId, setConsentId] = useState(null);
  const [generatedAudio, setGeneratedAudio] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(null);

  const origRef = useRef(null);
  const genRef = useRef(null);
  const [existingLibrary, setExistingLibrary] = useState([]);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace("/login");
      setSession(data.session);
      // مكتبة المدرسة المعتمَدة بالفعل — لعرضها هنا أيضًا، لا فقط في
      // صفحة "إنشاء رسالة صوتية"، حتى يرى المعلم ما هو موجود قبل تكرار
      // استنساخ نفس الشخص بالخطأ.
      const { data: rows } = await supabase
        .from("voice_samples")
        .select("id, voice_name, age_stage, description, match_pct")
        .eq("is_approved", true)
        .not("voice_model_id", "is", null)
        .order("created_at", { ascending: false });
      setExistingLibrary(rows || []);
      setLoadingExisting(false);
    });
  }, [router]);

  useEffect(() => {
    if (mode === "upload" && file) setOriginalUrl(URL.createObjectURL(file));
  }, [file, mode]);

  useEffect(() => {
    const o = origRef.current, g = genRef.current;
    if (!o || !g) return;
    const pause = (self, other) => () => other && other.pause();
    o.addEventListener("play", pause(o, g));
    g.addEventListener("play", pause(g, o));
  }, [originalUrl, generatedAudio]);

  const playSequential = () => {
    if (!origRef.current || !genRef.current) return;
    origRef.current.currentTime = 0; genRef.current.currentTime = 0;
    origRef.current.play();
    origRef.current.onended = () => genRef.current.play();
  };

  const startRecording = async () => {
    setErr(""); setRecordedBlob(null);
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
      setErr("تعذّر الوصول للميكروفون.");
    }
  };
  const stopRecording = () => { mediaRef.current?.stop(); setRecording(false); };

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const runAnalysis = async () => {
    const blob = mode === "upload" ? file : recordedBlob;
    if (!blob) return setErr(mode === "upload" ? "اختر ملفًا أولًا." : "سجّل صوتًا أولًا.");
    if (!ownerName.trim()) return setErr("اكتب اسم صاحب الصوت.");
    if (!agree) return setErr("يجب تأكيد امتلاكك موافقة صاحب الصوت.");

    setErr(""); setOrigAnalysis(null);
    try {
      setStatus("uploading");
      const audioBase64 = await blobToBase64(blob);
      setStatus("analyzing");
      const res = await fetch("/api/analyze-sample", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type, accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrigAnalysis(data.analysis);
      // "العينة تحتاج إلى تحسين" — حكم حقيقي مبني على قياسات فعلية، لا تخمينًا:
      // مدة قصيرة جدًّا أو مدى ديناميكي شبه معدوم (صوت شبه صامت).
      const needsWork = (data.analysis.duration_seconds < 3) || (typeof data.analysis.dynamic_range_db === "number" && data.analysis.dynamic_range_db < 2);
      setStatus(needsWork ? "needs_improvement" : "analyzed");
    } catch (e) {
      setErr("تعذّر التحليل: " + e.message);
      setStatus("failed");
    }
  };

  const [tuneSettings, setTuneSettings] = useState({ similarity_boost: 0.9, stability: 0.55, style: 0.2, speed: 1.0, pitch: 0, warmth: false, de_ess: false, speaker_boost: true, target_lufs: -16 });
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [testText, setTestText] = useState("أهلًا بكم، اسمي أحمد، وهذا صوتي الحقيقي الذي أتحدّث به كل يوم مع من حولي. أحبّ أن أروي القصص وأشارك أفكاري، سواء في العمل أو بين الأصدقاء والعائلة، فالكلام وسيلتي المفضّلة للتواصل والتعبير عمّا يدور في ذهني. صوتي فيه شيء من الدفء أحيانًا، وفيه حماس واضح حين أتحدّث عن موضوع يهمّني حقًّا أو حين أشارك خبرًا سعيدًا. أستمتع بقراءة الكتب المتنوّعة، والاستماع للموسيقى الهادئة في المساء بعد يوم طويل، والتنزّه في الحدائق العامة حين يسمح الوقت بذلك. أؤمن أن لكل إنسان بصمة صوتية خاصة تميّزه عن غيره تمامًا كبصمة أصابعه، وهذا بالضبط ما أتمنى أن يظهر بوضوح تام في هذا التسجيل. شكرًا جزيلًا لاستماعكم، وأتمنى لكم يومًا سعيدًا مليئًا بالإنجاز والراحة والابتسامات الصادقة.");
  const [transcribing, setTranscribing] = useState(false);

  // مساعد مشترك: يولّد بصوت مستنسَخ موجود بالفعل، ثم يحلّل الناتج بالنص
  // المعروف فعليًّا (لحساب سرعة الكلام الحقيقية)، للاستعمال في التوليد
  // الأول وإعادة التوليد بعد الضبط معًا — بلا تكرار الكود.
  const generateAndAnalyze = async (vId, settingsToUse) => {
    const res = await fetch("/api/preview-voice", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: testText, voiceId: vId, settings: settingsToUse, accessToken: session.access_token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setGeneratedAudio(`data:audio/mpeg;base64,${data.audioBase64}`);

    const genRes = await fetch("/api/analyze-sample", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: data.audioBase64, mimeType: "audio/mpeg", knownText: testText, accessToken: session.access_token }),
    });
    const genData = await genRes.json();
    if (genRes.ok) setGenAnalysis(genData.analysis);
  };

  const cloneAndGenerate = async () => {
    const blob = mode === "upload" ? file : recordedBlob;
    if (!blob) return;
    if (!testText.trim()) return setErr("اكتب نفس الكلام الذي قلته في التسجيل الأصلي أولًا — بلا هذا لن تكون المقارنة حقيقية.");
    setErr("");
    try {
      setStatus("cloning");
      const consentRes = await fetch("/api/consent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentText: CONSENT_TEXT, accessToken: session.access_token }),
      });
      const consentData = await consentRes.json();
      if (!consentRes.ok) throw new Error(consentData.error);
      setConsentId(consentData.consentId);

      const sampleBase64 = await blobToBase64(blob);
      setStatus("generating");
      const res = await fetch("/api/preview-voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText, sampleBase64, sampleMimeType: blob.type, settings: tuneSettings, accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVoiceId(data.voiceId);
      setGeneratedAudio(`data:audio/mpeg;base64,${data.audioBase64}`);

      const genRes = await fetch("/api/analyze-sample", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: data.audioBase64, mimeType: "audio/mpeg", knownText: testText, accessToken: session.access_token }),
      });
      const genData = await genRes.json();
      if (genRes.ok) setGenAnalysis(genData.analysis);

      setStatus("success");
    } catch (e) {
      setErr("تعذّر الاستنساخ: " + e.message);
      setStatus("failed");
    }
  };

  const match = computeMatch(origAnalysis, genAnalysis);

  // اقتراحات ذكية حقيقية مبنية على فروقات القياس الفعلية بين الأصلي
  // والمُستنسَخ — لا افتراضًا: إن كانت الطبقة أعلى في المُولَّد، نقترح
  // خفضها؛ إن كان أقل دفئًا، نقترح تعزيز الدفء، وهكذا.
  const suggestTuning = () => {
    if (!origAnalysis || !genAnalysis) return tuneSettings;
    const s = { ...tuneSettings };
    if (typeof origAnalysis.pitch_hz === "number" && typeof genAnalysis.pitch_hz === "number") {
      const pctDiff = Math.round(((origAnalysis.pitch_hz - genAnalysis.pitch_hz) / genAnalysis.pitch_hz) * 100);
      s.pitch = Math.max(-20, Math.min(20, pctDiff));
    }
    if (typeof origAnalysis.warmth_pct === "number" && typeof genAnalysis.warmth_pct === "number" && origAnalysis.warmth_pct - genAnalysis.warmth_pct > 10) {
      s.warmth = true;
    }
    if (typeof origAnalysis.loudness_lufs === "number") {
      s.target_lufs = Math.round(origAnalysis.loudness_lufs);
    }
    return s;
  };

  const openTuning = () => { setTuneSettings(suggestTuning()); setTuneOpen(true); };

  const regenerateWithTuning = async () => {
    setTuning(true); setErr("");
    try {
      await generateAndAnalyze(voiceId, tuneSettings);
    } catch (e) {
      setErr("تعذّر إعادة التوليد: " + e.message);
    }
    setTuning(false);
  };

  const approve = async () => {
    if (!voiceId) return;
    if (!consentId) { setErr("تعذّر العثور على سجلّ الموافقة القانونية — أعد الاستنساخ من البداية."); return; }
    setApproving(true); setErr("");
    const supabase = createClient();
    const { data: row, error } = await supabase.from("voice_samples").insert({
      speaker_id: null,
      owner_id: session.user.id,
      voice_model_id: voiceId,
      voice_name: ownerName.trim(),
      age_stage: ageStage,
      description: description.trim() || null,
      source_type: mode,
      consent_id: consentId,
      storage_path: null, // لا نحتفظ بالعيّنة الأصلية مطلقًا في هذا المسار — تُحذف عمليًّا بعدم تخزينها أصلًا
      status: "ready",
      is_approved: true,
      analysis: origAnalysis,
      generated_analysis: genAnalysis,
      match_pct: match?.overallPct ?? null,
      settings: tuneSettings,
    }).select("*").single();
    setApproving(false);
    if (error) return setErr("تعذّر الاعتماد: " + error.message);
    setApproved(row);
  };

  if (!session) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;

  // بعد الاعتماد: أخفِ كل التحليلات والعينات، اعرض بطاقة الصوت المعتمد فقط
  if (approved) {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
        <p style={{ color: "#14746F", fontWeight: 700, marginBottom: 20 }}>تم اعتماد الصوت وإضافته إلى مكتبة أصوات المدرسة بنجاح</p>
        <div style={{ padding: 20, background: "#fff", borderRadius: 14, border: "1px solid #DCE4DF", textAlign: "right" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{approved.voice_name}</div>
            <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "#EAF3F1", color: "#14746F", fontWeight: 700 }}>صوت مدرسي معتمد</span>
          </div>
          {generatedAudio && <audio controls src={generatedAudio} style={{ width: "100%", marginBottom: 10 }} />}
          <div style={{ fontSize: 13, color: "#5B6F6C" }}>المرحلة العمرية: {approved.age_stage}</div>
          {approved.match_pct != null && <div style={{ fontSize: 13, color: "#5B6F6C" }}>نسبة التطابق: {approved.match_pct}%</div>}
        </div>
        <button onClick={() => router.push("/dashboard")} style={{ marginTop: 20, padding: "10px 20px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
          العودة للوحة التحكم
        </button>
      </div>
    );
  }

  const processing = ["uploading", "analyzing", "cloning", "generating"].includes(status);
  const statusLabel = { uploading: "جارٍ رفع الصوت…", analyzing: "جارٍ تحليل العينة…", cloning: "جارٍ الاستنساخ…", generating: "جارٍ التوليد…" }[status];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push("/dashboard")} style={{ background: "none", border: "none", color: "#5B6F6C", cursor: "pointer", marginBottom: 12, padding: 0 }}>→ العودة للوحة التحكم</button>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>استنساخ صوت</h1>
      <p style={{ color: "#5B6F6C", marginBottom: 24 }}>سجّل أو ارفع عينة، حلّلها، استنسخها، وقارنها قبل اعتمادها في مكتبة أصوات المدرسة.</p>

      {(status === "idle" || status === "failed") && existingLibrary.length > 0 && (
        <div style={{ marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>مكتبة المدرسة الحالية ({existingLibrary.length})</div>
          <div style={{ display: "grid", gap: 8, maxHeight: 200, overflowY: "auto" }}>
            {existingLibrary.map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#F9FAF9", borderRadius: 8, fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{v.voice_name}</span>
                  <span style={{ color: "#5B6F6C" }}> — {v.age_stage}{v.match_pct != null ? ` — تطابق ${v.match_pct}%` : ""}</span>
                </div>
                <button onClick={async () => {
                  if (!confirm(`حذف صوت "${v.voice_name}" نهائيًّا من مكتبة المدرسة؟`)) return;
                  const supabase = createClient();
                  const { error } = await supabase.from("voice_samples").delete().eq("id", v.id);
                  if (error) return alert("تعذّر الحذف: " + error.message);
                  setExistingLibrary((prev) => prev.filter((x) => x.id !== v.id));
                }} title="حذف من المكتبة" style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #F0D5D0", background: "#fff", color: "#A6402F", cursor: "pointer", fontSize: 13 }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === "idle" || status === "failed" ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setMode("upload")} style={tabBtn(mode === "upload")}>رفع ملف صوتي من الجهاز</button>
            <button onClick={() => setMode("record")} style={tabBtn(mode === "record")}>تسجيل صوت جديد</button>
          </div>

          {mode === "upload" ? (
            <>
              <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 10 }} />
              {file && <div style={{ marginBottom: 16 }}><audio controls src={URL.createObjectURL(file)} style={{ width: "100%" }} /></div>}
            </>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {!recording ? (
                <button onClick={startRecording} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#A6402F", color: "#fff", cursor: "pointer" }}>● بدء التسجيل</button>
              ) : (
                <button onClick={stopRecording} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", cursor: "pointer" }}>■ إيقاف</button>
              )}
              {recordedBlob && !recording && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                  <audio controls src={URL.createObjectURL(recordedBlob)} style={{ flex: 1 }} />
                  <button onClick={startRecording} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #DCE4DF", background: "#fff", cursor: "pointer" }}>إعادة التسجيل</button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div><label style={lbl}>اسم صاحب الصوت</label><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={inp} /></div>
            <div><label style={lbl}>المرحلة العمرية</label>
              <select value={ageStage} onChange={(e) => setAgeStage(e.target.value)} style={inp}>
                {AGE_STAGES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div><label style={lbl}>وصف اختياري للصوت</label><input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} placeholder="مثلًا: صوت حواري هادئ" /></div>
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{CONSENT_TEXT}</span>
          </label>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>اكتب نفس الكلام الذي قلته في التسجيل الأصلي بالضبط</label>
            <p style={{ fontSize: 11, color: "#9AA6A3", margin: "0 0 6px" }}>ضروري لمقارنة حقيقية — بلا هذا سيُقرأ نص عام غير مرتبط بتسجيلك، فتكون كل مقارنات المدة والسرعة والوقفات لاحقًا بلا معنى حقيقي. لأفضل مقارنة، اكتب نصًّا كافيًا لتوليد **40 ثانية فأكثر** من الكلام.</p>
            <textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={4} placeholder="مثال: أهلًا بكم، اسمي أحمد وهذا صوتي. اكتب فقرة كافية الطول لتقارن جودة الاستنساخ بدقة أكبر..." style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #DCE4DF", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>

          {err && <div style={{ color: "#A6402F", fontSize: 13, marginBottom: 14 }}>{err} {status === "failed" && <button onClick={runAnalysis} style={{ marginRight: 8, color: "#14746F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>أعد المحاولة</button>}</div>}
          <button disabled={processing} onClick={runAnalysis} style={btnPrimary}>{processing ? statusLabel : "بدء التحليل"}</button>
        </>
      ) : (
        <div>
          {(originalUrl || generatedAudio) && (
            <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF", marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 4 }}>العيّنة الأصلية</div>
                  {originalUrl && <audio ref={origRef} controls src={originalUrl} style={{ width: "100%" }} />}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 4 }}>الصوت المُستنسَخ</div>
                  {generatedAudio ? <audio ref={genRef} controls src={generatedAudio} style={{ width: "100%" }} /> : <div style={{ fontSize: 12, color: "#9AA6A3" }}>لم يُستنسَخ بعد</div>}
                </div>
              </div>
              {originalUrl && generatedAudio && <button onClick={playSequential} style={btnOutline}>▶ تشغيل الصوتين بالتتابع</button>}
            </div>
          )}

          {status === "needs_improvement" && (
            <div style={{ padding: 14, background: "#FBF3E8", borderRadius: 10, border: "1px solid #E8D0A8", marginBottom: 16, fontSize: 13 }}>
              ⚠️ العينة تحتاج إلى تحسين (قصيرة جدًّا أو منخفضة المدى الديناميكي). يمكنك المتابعة، لكن جودة الاستنساخ قد تتأثّر — يُفضَّل تسجيل عينة أوضح وأطول.
            </div>
          )}

          {origAnalysis && <AnalysisPanel title="تحليل العينة الأصلية" data={origAnalysis} />}

          {err && <div style={{ color: "#A6402F", fontSize: 13, margin: "14px 0" }}>{err} {status === "failed" && <button onClick={cloneAndGenerate} style={{ marginRight: 8, color: "#14746F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>أعد المحاولة</button>}</div>}

          {!generatedAudio && (
            <button disabled={processing} onClick={cloneAndGenerate} style={{ ...btnPrimary, marginTop: 16 }}>{processing ? statusLabel : "استنساخ الصوت وتوليد عينة"}</button>
          )}

          {genAnalysis && (
            <>
              <div style={{ marginTop: 20 }}><AnalysisPanel title="تحليل الصوت المُستنسَخ" data={genAnalysis} /></div>
              {match && <MatchPanel match={match} />}
              {match && <ComparisonChart rows={match.rows} />}

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={openTuning} style={btnOutline}>🎚️ ضبط الصوت ليبدو أكثر بشرية</button>
                <button disabled={approving} onClick={approve} style={{ ...btnPrimary, flex: 1 }}>{approving ? "جارٍ الاعتماد…" : "اعتماد الصوت"}</button>
              </div>

              {tuneOpen && (
                <div style={{ marginTop: 14, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>ضبط بناءً على الفروقات الحقيقية المقيسة بين الصوتين</div>
                  <TuneCircles settings={tuneSettings} onChange={setTuneSettings} orig={origAnalysis} gen={genAnalysis} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button disabled={tuning} onClick={regenerateWithTuning} style={btnPrimary}>{tuning ? "جارٍ إعادة التوليد…" : "أعِد التوليد بهذه الإعدادات"}</button>
                    <button onClick={() => setTuneOpen(false)} style={btnOutline}>إغلاق</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TuneCircles({ settings, onChange, orig, gen }) {
  const num = (v) => typeof v === "number";

  // الطبقة الصوتية: لا نقارن Hz مباشرة بنسبة إزاحة % — بل نحسب النسبة
  // المستهدفة فعليًّا (نفس حساب الاقتراح التلقائي) لنعرضها كـ"الأصلي"
  // على نفس مقياس الإعداد (%)، فتُصبح المقارنة منطقية على نفس الوحدة.
  const pitchTarget = num(orig?.pitch_hz) && num(gen?.pitch_hz)
    ? Math.max(-20, Math.min(20, Math.round(((orig.pitch_hz - gen.pitch_hz) / gen.pitch_hz) * 100)))
    : null;

  const set = (key) => (v) => onChange({ ...settings, [key]: v });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
        <DualCircleControl label="مستوى الصوت" unit=" LUFS" min={-30} max={-9} step={0.1}
          original={num(orig?.loudness_lufs) ? orig.loudness_lufs : null} value={settings.target_lufs} onChange={set("target_lufs")} />
        <DualCircleControl label="طبقة الصوت" min={-20} max={20} step={0.1} fmt={(v) => `${v > 0 ? "+" : ""}${v}%`}
          original={pitchTarget} value={settings.pitch} onChange={set("pitch")} />
        <DualCircleControl label="ثبات الصوت (إعداد توليد — لا مقابل تحليلي مباشر)" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
          original={null} value={settings.stability} onChange={set("stability")} />
        <DualCircleControl label="التشابه والوضوح" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
          original={null} value={settings.similarity_boost} onChange={set("similarity_boost")} />
        <DualCircleControl label="قوة التعبير" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
          original={null} value={settings.style} onChange={set("style")} />
        <DualCircleControl label="سرعة الكلام" min={0.7} max={1.2} step={0.01} fmt={(v) => v.toFixed(2)}
          original={null} value={settings.speed} onChange={set("speed")} />
        <DualCircleControl label="المدى الديناميكي (ضغط الصوت)" min={1} max={10} step={0.5} fmt={(v) => v <= 1 ? "بلا ضغط" : `نسبة ${v.toFixed(1)}:1`}
          original={null} value={settings.compress_ratio ?? 1} onChange={set("compress_ratio")} />
      </div>
      <p style={{ fontSize: 11, color: "#9AA6A3", marginBottom: 14 }}>الدوائر بلا حلقة خضراء مرجعية (التشابه، التعبير، السرعة، المدى الديناميكي) لا تملك قيمة أصلية قابلة للقياس المباشر على نفس المقياس — تبقى قابلة للضبط اليدوي، وتؤثّر فعليًّا في الصوت المُولَّد عند إعادة التوليد.</p>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
        <input type="checkbox" checked={settings.warmth} onChange={(e) => onChange({ ...settings, warmth: e.target.checked })} />
        دفء الصوت (مقترح تلقائيًّا إن كانت العينة الأصلية أدفأ)
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={settings.speaker_boost} onChange={(e) => onChange({ ...settings, speaker_boost: e.target.checked })} />
        تعزيز صوت المتحدث
      </label>
    </div>
  );
}

function AnalysisPanel({ title, data }) {
  const rows = [
    ["مدة العينة", data.duration_seconds, "ثانية"],
    ["مستوى الصوت", data.loudness_lufs, "LUFS"],
    ["طبقة الصوت", data.pitch_hz, "Hz"],
    ["مدى الطبقة", Array.isArray(data.pitch_range_hz) ? `${data.pitch_range_hz[0]}–${data.pitch_range_hz[1]}` : data.pitch_range_hz, "Hz"],
    ["اهتزاز التردد (Jitter)", data.jitter_pct, "%"],
    ["اهتزاز الشدة (Shimmer)", data.shimmer_db, "dB"],
    ["نقاء الصوت (HNR)", data.hnr_db, "dB"],
    ["المدى الديناميكي", data.dynamic_range_db, "dB"],
    ["دفء الصوت (تقديري)", data.warmth_pct, "%"],
    ["عدد الوقفات", data.pause_count, ""],
    ["متوسط طول الوقفة", data.avg_pause_ms, "مللي ثانية"],
    ["هوية وبصمة الصوت", data.voice_identity_fingerprint, ""],
    ["اللغة واللهجة", data.accent_language, ""],
    ["قوة التعبير والانفعال", data.expressiveness_level, ""],
    ["وضوح النطق", data.articulation_clarity, ""],
    ["التنفس الطبيعي", data.natural_breathing, ""],
    ["سرعة الكلام", data.speech_rate_wpm, ""],
  ];
  return (
    <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        {rows.map(([label, val, unit]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0F3F1", paddingBottom: 4 }}>
            <span style={{ color: "#5B6F6C" }}>{label}</span>
            <span style={{ fontWeight: typeof val === "string" && val.includes("غير متاح") ? 400 : 600, color: typeof val === "string" && val.includes("غير متاح") ? "#9AA6A3" : "#14201E" }}>{val}{unit ? ` ${unit}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchPanel({ match }) {
  const color = (pct) => pct == null ? "#9AA6A3" : pct >= 75 ? "#1D8348" : pct >= 45 ? "#D4A017" : "#DC2626";
  return (
    <div style={{ marginTop: 16, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", margin: "0 auto 8px", background: `conic-gradient(${color(match.overallPct)} ${(match.overallPct || 0) * 3.6}deg, #E7ECEA 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 66, height: 66, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: color(match.overallPct) }}>{match.overallPct != null ? `${match.overallPct}%` : "—"}</span>
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>نسبة التطابق الكلية</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {match.rows.map((r) => (
          <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span>{r.label}</span>
            <span style={{ color: "#9AA6A3" }}>{r.original}{r.unit} ← {r.generated}{r.unit}</span>
            <span style={{ fontWeight: 700, color: color(r.matchPct) }}>{r.matchPct != null ? `${r.matchPct}%${r.matchPct >= 90 ? " متطابق" : ""}` : "غير متاح"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// رسم بياني حقيقي (أعمدة أفقية) — يقارن القيمة الفعلية المقاسة من العيّنة
// الأصلية بالقيمة الفعلية المقاسة من المُولَّد، لكل معيار على حدة (كل
// معيار بمقياسه الخاص لاختلاف الوحدات جذريًّا بينها).
function ComparisonChart({ rows }) {
  const numeric = rows.filter((r) => typeof r.original === "number" && typeof r.generated === "number");
  if (!numeric.length) return null;
  return (
    <div style={{ marginTop: 16, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>📊 مقارنة بيانية — الأصلي مقابل المُولَّد</div>
      <div style={{ display: "grid", gap: 16 }}>
        {numeric.map((r) => {
          const maxAbs = Math.max(Math.abs(r.original), Math.abs(r.generated), 0.0001);
          const origPct = (Math.abs(r.original) / maxAbs) * 100;
          const genPct = (Math.abs(r.generated) / maxAbs) * 100;
          return (
            <div key={r.key}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{r.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#9AA6A3", width: 46 }}>الأصلي</span>
                <div style={{ flex: 1, height: 14, background: "#F0F3F1", borderRadius: 7, overflow: "hidden" }}>
                  <div style={{ width: `${origPct}%`, height: "100%", background: "#14746F", borderRadius: 7, transition: "width .4s" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, width: 60, textAlign: "left" }}>{r.original}{r.unit}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#9AA6A3", width: 46 }}>المُولَّد</span>
                <div style={{ flex: 1, height: 14, background: "#F0F3F1", borderRadius: 7, overflow: "hidden" }}>
                  <div style={{ width: `${genPct}%`, height: "100%", background: "#C99A2E", borderRadius: 7, transition: "width .4s" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, width: 60, textAlign: "left" }}>{r.generated}{r.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DCE4DF", fontSize: 15, boxSizing: "border-box" };
const tabBtn = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "1px solid #DCE4DF", cursor: "pointer", background: active ? "#14746F" : "#fff", color: active ? "#fff" : "#14201E" });
const btnPrimary = { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const btnOutline = { padding: "8px 16px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" };

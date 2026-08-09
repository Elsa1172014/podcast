"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabaseClient";

const CONSENT_TEXT = "أقرّ بأنني صاحب هذا الصوت، أو أملك إذنًا صريحًا من صاحبه لاستنساخه واستعماله في هذه المنصة، وأتحمّل المسؤولية الكاملة عن صحة هذا الإقرار.";
const AGE_STAGES = ["طفل", "طالب ابتدائي", "طالب متوسط", "طالب ثانوي", "شاب", "بالغ", "كبير السن"];
const TEST_PARAGRAPH = "أهلًا بكم، هذه عيّنة تجريبية لاختبار الصوت المُستنسَخ ومقارنته بالعيّنة الأصلية.";

// خاصيات حقيقية قابلة للمقارنة مباشرة (رقمية) — لكل واحدة وحدتها ووزنها
// النسبي في حساب "نسبة التطابق الكلية". الخاصيات "غير المتاحة" (هوية،
// لهجة، انفعال...) لا تدخل هذا الحساب لأنها غير مقيسة أصلًا — لا نموّه
// رقمًا كليًّا بإدراج تقديرات وهمية ضمنه.
const COMPARABLE = [
  { key: "loudness_lufs", label: "مستوى الصوت", unit: "LUFS", tolerance: 6 },
  { key: "pitch_hz", label: "طبقة الصوت", unit: "Hz", tolerance: 40 },
  { key: "stability_pct", label: "ثبات الصوت", unit: "%", tolerance: 25 },
  { key: "dynamic_range_db", label: "المدى الديناميكي", unit: "dB", tolerance: 8 },
  { key: "warmth_pct", label: "دفء الصوت", unit: "%", tolerance: 25 },
];

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

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return router.replace("/login");
      setSession(data.session);
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

  // مساعد مشترك: يولّد بصوت مستنسَخ موجود بالفعل، ثم يحلّل الناتج بالنص
  // المعروف فعليًّا (لحساب سرعة الكلام الحقيقية)، للاستعمال في التوليد
  // الأول وإعادة التوليد بعد الضبط معًا — بلا تكرار الكود.
  const generateAndAnalyze = async (vId, settingsToUse) => {
    const res = await fetch("/api/preview-voice", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: TEST_PARAGRAPH, voiceId: vId, settings: settingsToUse, accessToken: session.access_token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setGeneratedAudio(`data:audio/mpeg;base64,${data.audioBase64}`);

    const genRes = await fetch("/api/analyze-sample", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: data.audioBase64, mimeType: "audio/mpeg", knownText: TEST_PARAGRAPH, accessToken: session.access_token }),
    });
    const genData = await genRes.json();
    if (genRes.ok) setGenAnalysis(genData.analysis);
  };

  const cloneAndGenerate = async () => {
    const blob = mode === "upload" ? file : recordedBlob;
    if (!blob) return;
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
        body: JSON.stringify({ text: TEST_PARAGRAPH, sampleBase64, sampleMimeType: blob.type, settings: tuneSettings, accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVoiceId(data.voiceId);
      setGeneratedAudio(`data:audio/mpeg;base64,${data.audioBase64}`);

      const genRes = await fetch("/api/analyze-sample", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: data.audioBase64, mimeType: "audio/mpeg", knownText: TEST_PARAGRAPH, accessToken: session.access_token }),
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

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={openTuning} style={btnOutline}>🎚️ ضبط الصوت ليبدو أكثر بشرية</button>
                <button disabled={approving} onClick={approve} style={{ ...btnPrimary, flex: 1 }}>{approving ? "جارٍ الاعتماد…" : "اعتماد الصوت"}</button>
              </div>

              {tuneOpen && (
                <div style={{ marginTop: 14, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>ضبط بناءً على الفروقات الحقيقية المقيسة بين الصوتين</div>
                  <TuneSliders settings={tuneSettings} onChange={setTuneSettings} />
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

function TuneSliders({ settings, onChange }) {
  const slider = (key, label, min, max, step, fmt) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{label}</span><span style={{ color: "#5B6F6C", fontWeight: 700 }}>{fmt ? fmt(settings[key]) : settings[key]}</span></div>
      <input type="range" min={min} max={max} step={step} value={settings[key]} onChange={(e) => onChange({ ...settings, [key]: parseFloat(e.target.value) })} style={{ width: "100%" }} />
    </div>
  );
  return (
    <div>
      {slider("similarity_boost", "التشابه والوضوح", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      {slider("stability", "ثبات الصوت", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      {slider("style", "قوة التعبير", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      {slider("speed", "سرعة الكلام", 0.7, 1.2, 0.01, (v) => v.toFixed(2))}
      {slider("pitch", "طبقة الصوت (مقترحة تلقائيًّا من الفرق الحقيقي المقيس)", -20, 20, 1, (v) => `${v > 0 ? "+" : ""}${v}%`)}
      {slider("target_lufs", "مستوى الصوت المستهدف", -30, -9, 1, (v) => `${v} LUFS`)}
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
    ["ثبات الصوت", data.stability_pct, "%"],
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
  const color = (pct) => pct == null ? "#9AA6A3" : pct >= 75 ? "#14746F" : pct >= 45 ? "#C99A2E" : "#A6402F";
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

const lbl = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DCE4DF", fontSize: 15, boxSizing: "border-box" };
const tabBtn = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "1px solid #DCE4DF", cursor: "pointer", background: active ? "#14746F" : "#fff", color: active ? "#fff" : "#14201E" });
const btnPrimary = { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const btnOutline = { padding: "8px 16px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" };

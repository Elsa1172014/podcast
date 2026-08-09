"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabaseClient";

export default function VoiceMessage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [text, setText] = useState("");
  const [library, setLibrary] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [chosen, setChosen] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBase64, setAudioBase64] = useState(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace("/login");
      setSession(data.session);

      // مكتبة الأصوات المعتمدة — مشتركة بين كل المعلمين (سياسة القراءة
      // العامة للمعتمَد التي أضفناها في ترقية قاعدة البيانات سابقًا).
      const { data: rows } = await supabase
        .from("voice_samples")
        .select("id, voice_name, voice_model_id, age_stage, description, settings, source_type")
        .eq("is_approved", true)
        .not("voice_model_id", "is", null)
        .order("created_at", { ascending: false });
      setLibrary(rows || []);
      setLoadingLibrary(false);
    });
  }, [router]);

  if (!session) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const generate = async () => {
    if (!text.trim()) return setErr("اكتب نص الرسالة أولًا.");
    if (!chosen) return setErr("اختر صوتًا من المكتبة أولًا.");
    setErr(""); setGenerating(true); setAudioUrl(null);
    try {
      const res = await fetch("/api/preview-voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(), voiceId: chosen.voice_model_id,
          settings: chosen.settings || { similarity_boost: 0.9, stability: 0.55, style: 0.2, speed: 1.0, speaker_boost: true },
          accessToken: session.access_token,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAudioBase64(data.audioBase64);
      setAudioUrl(`data:audio/mpeg;base64,${data.audioBase64}`);
    } catch (e) {
      setErr("تعذّر التوليد: " + e.message);
    }
    setGenerating(false);
  };

  const download = () => {
    if (!audioBase64) return;
    const byteChars = atob(audioBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `رسالة-صوتية-${Date.now()}.mp3`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push("/dashboard")} style={{ background: "none", border: "none", color: "#5B6F6C", cursor: "pointer", marginBottom: 12, padding: 0 }}>→ العودة للوحة التحكم</button>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>إنشاء رسالة صوتية</h1>
      <p style={{ color: "#5B6F6C", marginBottom: 24 }}>نص قصير بصوت من المكتبة — جاهز للتحميل والمشاركة مباشرة.</p>

      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>نص الرسالة</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #DCE4DF", fontFamily: "inherit", fontSize: 15, boxSizing: "border-box", resize: "vertical" }} />
      <div style={{ fontSize: 12, color: "#9AA6A3", marginTop: 4, marginBottom: 18 }}>{wordCount} كلمة — {charCount} حرفًا</div>

      <div style={{ marginBottom: 18 }}>
        <button onClick={() => setPickerOpen(!pickerOpen)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #14746F", background: chosen ? "#EAF3F1" : "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" }}>
          {chosen ? `الصوت المختار: ${chosen.voice_name}` : "اختيار الصوت من المكتبة"}
        </button>

        {pickerOpen && (
          <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto", display: "grid", gap: 8 }}>
            {loadingLibrary ? (
              <div style={{ fontSize: 13, color: "#5B6F6C" }}>جارٍ التحميل…</div>
            ) : library.length === 0 ? (
              <div style={{ fontSize: 13, color: "#5B6F6C", padding: 16, background: "#fff", borderRadius: 8, border: "1px solid #DCE4DF" }}>لا أصوات معتمَدة في المكتبة بعد. اذهب لصفحة "استنساخ صوت" لإضافة أول صوت.</div>
            ) : (
              library.map((v) => (
                <div key={v.id} onClick={() => { setChosen(v); setPickerOpen(false); }}
                  style={{ padding: 12, background: "#fff", borderRadius: 8, border: chosen?.id === v.id ? "2px solid #14746F" : "1px solid #DCE4DF", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{v.voice_name}</div>
                    <div style={{ fontSize: 12, color: "#5B6F6C" }}>{[v.age_stage, v.description].filter(Boolean).join(" — ")}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "#EAF3F1", color: "#14746F", fontWeight: 700 }}>صوت مدرسي معتمد</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {err && <div style={{ color: "#A6402F", fontSize: 13, marginBottom: 14 }}>{err}</div>}
      <button disabled={generating} onClick={generate} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
        {generating ? "جارٍ التوليد…" : "توليد الرسالة الصوتية"}
      </button>

      {audioUrl && (
        <div style={{ marginTop: 20, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF" }}>
          <div style={{ fontSize: 13, color: "#5B6F6C", marginBottom: 8 }}>الصوت المستخدم: {chosen?.voice_name}</div>
          <audio controls src={audioUrl} style={{ width: "100%", marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={generate} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" }}>إعادة التوليد</button>
            <button onClick={download} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", fontWeight: 600, cursor: "pointer" }}>⬇ تحميل الملف</button>
          </div>
        </div>
      )}
    </div>
  );
}

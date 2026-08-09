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

  // مشاركة حقيقية عبر واجهة المشاركة الأصلية للمتصفح — تفتح قائمة
  // التطبيقات المثبَّتة فعليًّا (واتساب من بينها على الجوّال)، لا رابطًا
  // وهميًّا لا يستطيع إرفاق ملف صوتي (قيد حقيقي من واتساب نفسها، لا نقصًا
  // في هذا الكود).
  const shareToWhatsApp = async () => {
    if (!audioBase64) return;
    const byteChars = atob(audioBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const file = new File([bytes], `رسالة-صوتية-${Date.now()}.mp3`, { type: "audio/mpeg" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "رسالة صوتية", text: text.trim().slice(0, 100) });
        return;
      } catch {
        return; // المستخدم ألغى المشاركة — لا خطأ حقيقي
      }
    }
    // بديل صادق للمتصفحات التي لا تدعم مشاركة الملفات (غالبًا الحاسوب):
    // نُنزّل الملف فعليًّا، ونفتح واتساب ويب بنص توضيحي، لأن أي رابط لا
    // يستطيع إرفاق الملف تلقائيًّا بلا هذه الواجهة.
    download();
    window.open("https://wa.me/?text=" + encodeURIComponent("أرفق الملف الصوتي الذي نزَّلته للتوّ يدويًّا في واتساب — المتصفح الحالي لا يدعم إرفاق الملفات تلقائيًّا."), "_blank");
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
                <div key={v.id} style={{ padding: 12, background: "#fff", borderRadius: 8, border: chosen?.id === v.id ? "2px solid #14746F" : "1px solid #DCE4DF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div onClick={() => { setChosen(v); setPickerOpen(false); }} style={{ cursor: "pointer", flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{v.voice_name}</div>
                    <div style={{ fontSize: 12, color: "#5B6F6C" }}>{[v.age_stage, v.description].filter(Boolean).join(" — ")}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: "#EAF3F1", color: "#14746F", fontWeight: 700, marginLeft: 8 }}>صوت مدرسي معتمد</span>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`حذف صوت "${v.voice_name}" نهائيًّا من المكتبة؟`)) return;
                    const supabase = createClient();
                    const { error } = await supabase.from("voice_samples").delete().eq("id", v.id);
                    if (error) return alert("تعذّر الحذف: " + error.message);
                    setLibrary((prev) => prev.filter((x) => x.id !== v.id));
                    if (chosen?.id === v.id) setChosen(null);
                  }} title="حذف من المكتبة" style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #F0D5D0", background: "#fff", color: "#A6402F", cursor: "pointer", fontSize: 13, marginRight: 8 }}>🗑</button>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={generate} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #14746F", background: "#fff", color: "#14746F", fontWeight: 600, cursor: "pointer" }}>إعادة التوليد</button>
            <button onClick={download} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", fontWeight: 600, cursor: "pointer" }}>⬇ تحميل الملف</button>
            <button onClick={shareToWhatsApp} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "#25D366", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              <WhatsAppIcon /> مشاركة عبر واتساب
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.06-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18.13c-1.6 0-3.09-.44-4.37-1.2l-.31-.19-3 .79.8-2.92-.2-.3A8.11 8.11 0 0 1 3.87 12c0-4.48 3.65-8.13 8.13-8.13S20.13 7.52 20.13 12 16.48 20.13 12 20.13Zm4.52-6.07c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.84-.86 2.04 0 1.2.88 2.36 1 2.52.12.17 1.74 2.66 4.22 3.73.59.25 1.05.4 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  );
}

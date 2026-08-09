"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabaseClient";
import { parseScript } from "../../../../lib/parseScript";

const EXAMPLE = `المقدم: أهلًا بكم في حلقة جديدة من بودكاستنا.
الضيف: شكرًا لكم، سعيد بالمشاركة معكم.
المقدم: نبدأ بالسؤال الأول...`;

export default function ScriptEditor() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [text, setText] = useState("");
  const [detectedSpeakers, setDetectedSpeakers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/login");

      const { data: proj, error: projErr } = await supabase.from("projects").select("*").eq("id", id).single();
      if (projErr || !proj) { setErr("تعذّر العثور على المشروع."); setLoading(false); return; }
      setProject(proj);

      const { data: script } = await supabase.from("scripts").select("*").eq("project_id", id).maybeSingle();
      if (script) {
        setText(script.raw_text || "");
        setDetectedSpeakers(parseScript(script.raw_text || "").speakerNames);
      }

      setLoading(false);
    })();
  }, [id, router]);

  const saveAndDetect = async () => {
    setSaving(true); setErr(""); setMsg("");
    const supabase = createClient();
    const { segments, speakerNames } = parseScript(text);

    if (speakerNames.length === 0) {
      setSaving(false);
      return setErr('لم يُكتشَف أي متحدث. تأكّد من كتابة كل سطر بصيغة "الاسم: الحوار".');
    }

    // 1) حفظ السيناريو الخام (upsert بالاعتماد على قيد unique على project_id)
    const { data: existingScript } = await supabase.from("scripts").select("id").eq("project_id", id).maybeSingle();
    let scriptId = existingScript?.id;
    if (scriptId) {
      await supabase.from("scripts").update({ raw_text: text, updated_at: new Date().toISOString() }).eq("id", scriptId);
    } else {
      const { data } = await supabase.from("scripts").insert({ project_id: id, raw_text: text }).select("id").single();
      scriptId = data.id;
    }

    // 2) مطابقة المتحدثين المكتشَفين مع الموجودين، وإنشاء الجدد فقط
    const { data: existingSpeakers } = await supabase.from("speakers").select("*").eq("project_id", id);
    const existingNames = new Set((existingSpeakers || []).map((s) => s.display_name));
    const currentNames = new Set(speakerNames);
    const newNames = speakerNames.filter((n) => !existingNames.has(n));
    if (newNames.length) {
      await supabase.from("speakers").insert(newNames.map((display_name) => ({ project_id: id, display_name })));
    }
    // تنظيف: احذف متحدثين من محاولات سابقة خاطئة لم يعودوا مكتشَفين في هذا النص —
    // فقط إن لم تُربَط بهم عينة صوت بعد، حتى لا نفقد عملًا فعليًّا بالخطأ.
    const staleSpeakers = (existingSpeakers || []).filter((s) => !currentNames.has(s.display_name));
    if (staleSpeakers.length) {
      const { data: samples } = await supabase.from("voice_samples").select("speaker_id").in("speaker_id", staleSpeakers.map((s) => s.id));
      const linkedIds = new Set((samples || []).map((v) => v.speaker_id));
      const safeToDelete = staleSpeakers.filter((s) => !linkedIds.has(s.id)).map((s) => s.id);
      if (safeToDelete.length) await supabase.from("speakers").delete().in("id", safeToDelete);
    }
    const { data: allSpeakers } = await supabase.from("speakers").select("*").eq("project_id", id);
    const speakerIdByName = Object.fromEntries((allSpeakers || []).map((s) => [s.display_name, s.id]));

    // 3) استبدال المقاطع بالكامل بالنسخة الجديدة (أبسط من مطابقة تفاضلية في MVP)
    await supabase.from("script_segments").delete().eq("script_id", scriptId);
    const rows = segments.map((s) => ({
      script_id: scriptId,
      speaker_id: speakerIdByName[s.speaker_name] || null,
      order_index: s.order_index,
      text: s.text,
    }));
    const { error: insErr } = await supabase.from("script_segments").insert(rows);

    // 4) تحديث حالة المشروع
    if (!insErr) await supabase.from("projects").update({ status: "script_ready" }).eq("id", id);

    setDetectedSpeakers(speakerNames);
    setSaving(false);
    if (insErr) return setErr(insErr.message);
    setMsg(`تم الحفظ. اكتُشف ${speakerNames.length} متحدثًا و${segments.length} مقطعًا.`);
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;
  if (err && !project) return <div style={{ padding: 40, textAlign: "center", color: "#A6402F" }}>{err}</div>;

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>
      <button onClick={() => router.push("/dashboard")} style={{ background: "none", border: "none", color: "#5B6F6C", cursor: "pointer", marginBottom: 12, padding: 0 }}>→ العودة للوحة التحكم</button>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{project?.title}</h1>
      <p style={{ color: "#5B6F6C", marginBottom: 20 }}>اكتب الحوار بصيغة «الاسم: الجملة» — سطر لكل جملة أو فقرة.</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        rows={16}
        style={{ width: "100%", padding: 16, borderRadius: 10, border: "1px solid #DCE4DF", fontSize: 15, lineHeight: 1.9, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
      />

      {err && <div style={{ color: "#A6402F", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {msg && <div style={{ color: "#14746F", fontSize: 13, marginTop: 10, fontWeight: 600 }}>{msg}</div>}

      <button disabled={saving} onClick={saveAndDetect} style={{ marginTop: 16, padding: "12px 24px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
        {saving ? "جارٍ الحفظ والاكتشاف…" : "احفظ واكتشف المتحدثين"}
      </button>

      {detectedSpeakers.length > 0 && (
        <div style={{ marginTop: 28, padding: 16, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF" }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>المتحدثون المكتشَفون ({detectedSpeakers.length})</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {detectedSpeakers.map((n) => (
              <span key={n} style={{ padding: "6px 12px", borderRadius: 16, background: "#E3F0EE", color: "#14746F", fontSize: 13, fontWeight: 600 }}>{n}</span>
            ))}
          </div>
          <button onClick={() => router.push(`/project/${id}/voices`)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            التالي: ربط الأصوات بالمتحدثين ←
          </button>
        </div>
      )}
    </div>
  );
}

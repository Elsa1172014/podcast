"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabaseClient";

const STYLES = [
  ["dialogue", "حوار"], ["interview", "مقابلة"], ["story", "قصة"],
  ["report", "تقرير"], ["debate", "مناظرة"], ["educational", "بودكاست تعليمي"],
];

export default function NewProject() {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("dialogue");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const create = async () => {
    if (!title.trim()) return setErr("اكتب عنوان الحلقة أولًا.");
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.replace("/login");

    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: session.user.id,
        title: title.trim(),
        topic: topic.trim(),
        language: "ar",
        episode_style: style,
        status: "draft",
      })
      .select("id")
      .single();

    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/project/${data.id}/script`);
  };

  return (
    <div style={{ maxWidth: 560, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>مشروع بودكاست جديد</h1>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>عنوان الحلقة</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder="مثلًا: كيف نتعلّم اللغة العربية بمتعة" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>موضوع الحلقة (اختياري)</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} style={inp} placeholder="وصف قصير للموضوع" />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>نمط الحلقة</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STYLES.map(([k, l]) => (
            <button key={k} onClick={() => setStyle(k)}
              style={{ padding: "8px 14px", borderRadius: 20, border: "1px solid #DCE4DF", cursor: "pointer",
                background: style === k ? "#14746F" : "#fff", color: style === k ? "#fff" : "#14201E" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {err && <div style={{ color: "#A6402F", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <button disabled={busy} onClick={create} style={btn}>{busy ? "جارٍ الإنشاء…" : "إنشاء المشروع والمتابعة للسيناريو"}</button>
      <button onClick={() => router.push("/dashboard")} style={{ ...btn, background: "transparent", color: "#5B6F6C", marginTop: 8 }}>إلغاء</button>
    </div>
  );
}

const lbl = { display: "block", fontSize: 13, marginBottom: 6, fontWeight: 600 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DCE4DF", fontSize: 15, boxSizing: "border-box" };
const btn = { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };

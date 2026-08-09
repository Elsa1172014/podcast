"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabaseClient";

const STAGE_LABEL = {
  draft: "مسودة", script_ready: "السيناريو جاهز", voice_setup: "إعداد الأصوات",
  queued: "في قائمة الانتظار", processing: "جارٍ الإنتاج", preview_ready: "جاهز للمعاينة",
  failed: "فشل الإنتاج", completed: "مكتمل",
};

export default function ProducePage() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [started, setStarted] = useState(false);
  const [err, setErr] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const pollRef = useRef(null);

  const fetchProject = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(data);
    if (data?.status === "preview_ready" && data.final_audio_path) {
      const { data: signed } = await supabase.storage.from("episodes").createSignedUrl(data.final_audio_path, 3600);
      if (signed) setAudioUrl(signed.signedUrl);
    }
    return data;
  };

  useEffect(() => {
    fetchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!started) return;
    pollRef.current = setInterval(async () => {
      const p = await fetchProject();
      if (p && ["preview_ready", "failed", "completed"].includes(p.status)) {
        clearInterval(pollRef.current);
      }
    }, 3000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const start = async () => {
    setErr("");
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.replace("/login");

    const res = await fetch("/api/produce", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: id, accessToken: session.access_token }),
    });
    const data = await res.json();
    if (!res.ok) return setErr(data.error || "تعذّر بدء الإنتاج.");
    setStarted(true);
  };

  if (!project) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;

  const isProcessing = ["queued", "processing"].includes(project.status);
  const isDone = project.status === "preview_ready";
  const isFailed = project.status === "failed";

  return (
    <div style={{ maxWidth: 640, margin: "60px auto", padding: 24, textAlign: "center" }}>
      <button onClick={() => router.push(`/project/${id}/voices`)} style={{ background: "none", border: "none", color: "#5B6F6C", cursor: "pointer", marginBottom: 20, padding: 0, display: "block" }}>→ العودة لربط الأصوات</button>

      <h1 style={{ fontSize: 22, marginBottom: 24 }}>إنتاج الحلقة</h1>

      {!started && !isProcessing && !isDone && (
        <button onClick={start} style={{ padding: "14px 28px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          ابدأ إنتاج الحلقة
        </button>
      )}

      {(isProcessing || (started && !isDone && !isFailed)) && (
        <div>
          <div style={{ height: 10, background: "#DCE4DF", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", width: `${project.progress_pct || 0}%`, background: "#14746F", transition: "width .4s" }} />
          </div>
          <p style={{ color: "#5B6F6C" }}>{STAGE_LABEL[project.status] || project.status} — {project.progress_pct || 0}%</p>
          <p style={{ fontSize: 12, color: "#9AA6A3" }}>قد يستغرق أول تشغيل دقيقة إضافية إن كانت الخدمة نائمة — هذا طبيعي.</p>
        </div>
      )}

      {isFailed && (
        <div>
          <p style={{ color: "#A6402F", marginBottom: 12 }}>تعذّر إنتاج الحلقة.</p>
          <button onClick={start} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", cursor: "pointer" }}>أعد المحاولة</button>
        </div>
      )}

      {isDone && (
        <div>
          <p style={{ color: "#14746F", fontWeight: 600, marginBottom: 16 }}>الحلقة جاهزة للمعاينة 🎉</p>
          {audioUrl && <audio controls src={audioUrl} style={{ width: "100%" }} />}
          <p style={{ fontSize: 12, color: "#9AA6A3", marginTop: 12 }}>هذه معاينة أولية (وضع تجريبي حاليًا). التصدير النهائي وإعادة توليد مقطع بعينه يُبنيان لاحقًا.</p>
        </div>
      )}

      {err && <div style={{ color: "#A6402F", fontSize: 13, marginTop: 16 }}>{err}</div>}
    </div>
  );
}

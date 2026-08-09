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

  const [humanizing, setHumanizing] = useState(false);
  const [humanizeErr, setHumanizeErr] = useState("");
  const [humanizedUrl, setHumanizedUrl] = useState(null);
  const humanizePollRef = useRef(null);

  const fetchProject = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(data);
    if (data?.status === "preview_ready" && data.final_audio_path) {
      const { data: signed } = await supabase.storage.from("episodes").createSignedUrl(data.final_audio_path, 3600);
      if (signed) setAudioUrl(signed.signedUrl);
    }
    if (data?.humanized_audio_path) {
      const { data: signed2 } = await supabase.storage.from("episodes").createSignedUrl(data.humanized_audio_path, 3600);
      if (signed2) setHumanizedUrl(signed2.signedUrl);
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

  useEffect(() => {
    if (!humanizing) return;
    const startedAt = Date.now();
    humanizePollRef.current = setInterval(async () => {
      const p = await fetchProject();
      if (p?.humanized_at && new Date(p.humanized_at).getTime() >= startedAt - 5000) {
        setHumanizing(false);
        clearInterval(humanizePollRef.current);
      }
    }, 4000);
    return () => clearInterval(humanizePollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [humanizing]);

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

  const startHumanize = async () => {
    setHumanizeErr("");
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.replace("/login");

    const res = await fetch("/api/humanize-episode", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: id, accessToken: session.access_token }),
    });
    const data = await res.json();
    if (!res.ok) return setHumanizeErr(data.error || "تعذّر بدء المعالجة.");
    setHumanizing(true);
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

          <div style={{ marginTop: 24, padding: 18, background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF", textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>🧑‍🎨 معالجة الحلقة</div>
            <p style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 12 }}>
              فحص حقيقي لكل مقطع (تشوّه صوتي، فجوات صمت غير طبيعية، دقّة الكلمات فعليًّا عبر إعادة تحويلها لنص ومقارنتها، ورتابة الأداء)، وإعادة توليد المعيب منها فقط بنفس الصوت والنص، ثم توحيد مستوى الصوت على الحلقة كاملة.
              لا تصحيح لنطق الحروف بدقّة صوتية-لغوية ولا ضبط للتنفّس أو المدود — هذه غير قابلة للتحقّق أو التحكّم بالأدوات الحقيقية المتاحة حاليًّا.
            </p>

            {!project.humanized_audio_path && !humanizing && (
              <button onClick={startHumanize} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                ابدأ معالجة الحلقة
              </button>
            )}

            {humanizing && (
              <div>
                <div style={{ height: 8, background: "#DCE4DF", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ height: "100%", width: `${project.progress_pct || 0}%`, background: "#14201E", transition: "width .4s" }} />
                </div>
                <p style={{ fontSize: 12, color: "#5B6F6C" }}>جارٍ فحص كل مقطع وإعادة توليد ما يلزم — قد يستغرق دقائق حسب عدد المقاطع.</p>
              </div>
            )}

            {humanizeErr && <div style={{ color: "#A6402F", fontSize: 13, marginTop: 10 }}>{humanizeErr}</div>}

            {project.humanized_audio_path && !humanizing && (
              <div style={{ marginTop: 8 }}>
                <p style={{ color: "#14746F", fontWeight: 600, fontSize: 13, marginBottom: 10 }}>✅ اكتملت المعالجة والتحقّق من الملف الجديد فعليًّا</p>
                {humanizedUrl && <audio controls src={humanizedUrl} style={{ width: "100%", marginBottom: 10 }} />}
                {project.humanize_report && (
                  <p style={{ fontSize: 12, color: "#5B6F6C", marginBottom: 10 }}>
                    فُحص {project.humanize_report.totalSegments} مقطعًا — أُعيد توليد {project.humanize_report.regeneratedCount} منها فعليًّا
                    {project.humanize_report.regeneratedCount > 0 && project.humanize_report.reasons?.length > 0 && (
                      <span>: {project.humanize_report.reasons.map((r) => r.reasons.join("، ")).join(" | ")}</span>
                    )}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={startHumanize} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #14201E", background: "#fff", color: "#14201E", cursor: "pointer", fontSize: 13 }}>إعادة المعالجة</button>
                  <a href={humanizedUrl} download={`حلقة-معالَجة-${Date.now()}.mp3`} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#14201E", color: "#fff", cursor: "pointer", fontSize: 13, textDecoration: "none" }}>⬇ تحميل النسخة المعالَجة</a>
                </div>
              </div>
            )}
          </div>

          <p style={{ fontSize: 12, color: "#9AA6A3", marginTop: 12 }}>هذه معاينة أولية. النسخة المعالَجة أعلاه هي الأقرب للجاهزية للنشر.</p>
        </div>
      )}

      {err && <div style={{ color: "#A6402F", fontSize: 13, marginTop: 16 }}>{err}</div>}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabaseClient";

const MAIN_CARDS = [
  { key: "podcast", title: "إنشاء بودكاست", desc: "سيناريو حوار متعدّد المتحدثين، أصوات مستنسَخة أو جاهزة، وإنتاج كامل.", icon: "🎙️", color: "#14746F", route: "/project/new" },
  { key: "clone", title: "استنساخ صوت", desc: "سجّل أو ارفع عينة، حلّلها، استنسخها، واعتمدها في مكتبة أصوات المدرسة.", icon: "🧬", color: "#A6402F", route: "/voices/new" },
  { key: "message", title: "إنشاء رسالة صوتية", desc: "نص قصير بصوت من المكتبة — جاهز للتحميل والمشاركة مباشرة.", icon: "💬", color: "#8A6D1F", route: "/voice-message" },
];

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [audioUrls, setAudioUrls] = useState({});
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace("/login");
      setUser(data.session.user);
      const { data: rows } = await supabase
        .from("projects")
        .select("id, title, status, created_at, final_audio_path")
        .order("created_at", { ascending: false });
      setProjects(rows || []);
      setLoading(false);
    });
  }, [router]);

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <style>{`
        .hero-arabesque { position: relative; overflow: hidden; }
        .hero-arabesque::before {
          content: ""; position: absolute; inset: 0; opacity: .12; pointer-events: none;
          background-image: radial-gradient(circle at 20% 30%, #fff 0 2px, transparent 3px),
                             radial-gradient(circle at 60% 70%, #fff 0 2px, transparent 3px),
                             radial-gradient(circle at 85% 20%, #fff 0 2px, transparent 3px),
                             radial-gradient(circle at 40% 85%, #fff 0 2px, transparent 3px);
          background-size: 120px 120px;
        }
      `}</style>

      <div className="hero-arabesque" style={{
        background: "linear-gradient(135deg, #0E3A40, #14746F 55%, #1B8A80)",
        padding: "28px 24px 32px", borderRadius: "0 0 28px 28px", marginBottom: 28,
        color: "#fff",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1, opacity: .8, marginBottom: 6 }}>منصّة إنتاج البودكاست</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>أهلًا بك 👋</h1>
            <p style={{ opacity: .85, margin: "6px 0 0", fontSize: 13 }}>{user?.email}</p>
          </div>
          <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,.4)", background: "rgba(255,255,255,.08)", color: "#fff", cursor: "pointer" }}>خروج</button>
        </div>
      </div>

      <div style={{ padding: "0 24px" }}>
      {/* ثلاث بطاقات المسارات الرئيسية */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 32 }}>
        {MAIN_CARDS.map((c) => (
          <div key={c.key} onClick={() => router.push(c.route)}
            onMouseEnter={() => setHovered(c.key)} onMouseLeave={() => setHovered(null)}
            style={{
              padding: 22, borderRadius: 18, background: "#fff", border: "1px solid #DCE4DF", cursor: "pointer",
              boxShadow: hovered === c.key ? `0 12px 28px ${c.color}22` : "0 2px 8px rgba(0,0,0,.04)",
              transform: hovered === c.key ? "translateY(-4px)" : "translateY(0)",
              transition: "all .25s ease",
            }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: `${c.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>{c.icon}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, color: "#14201E" }}>{c.title}</div>
            <div style={{ fontSize: 13, color: "#5B6F6C", lineHeight: 1.7 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>مشروعاتك</h2>
      {projects.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", background: "#fff", borderRadius: 12, border: "1px solid #DCE4DF", color: "#5B6F6C" }}>
          لا مشروعات بعد. ابدأ بإنشاء أول حلقة بودكاست.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {projects.map((p) => (
            <div key={p.id} style={{ padding: 16, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => router.push(`/project/${p.id}/script`)}>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.title}</div>
                  <div style={{ fontSize: 13, color: "#5B6F6C" }}>{p.status}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {p.final_audio_path && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (playingId === p.id) { setPlayingId(null); return; }
                        if (!audioUrls[p.id]) {
                          const supabase = createClient();
                          const { data } = await supabase.storage.from("episodes").createSignedUrl(p.final_audio_path, 3600);
                          if (data?.signedUrl) setAudioUrls((prev) => ({ ...prev, [p.id]: data.signedUrl }));
                        }
                        setPlayingId(p.id);
                      }}
                      title="استمع للبودكاست الصوتي"
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #14746F", background: playingId === p.id ? "#EAF3F1" : "#fff", color: "#14746F", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>🎧 استمع</button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`حذف "${p.title}" نهائيًّا؟ سيُحذَف السيناريو والمتحدثون والأصوات المرتبطة به جميعًا.`)) return;
                      const supabase = createClient();
                      const { error } = await supabase.from("projects").delete().eq("id", p.id);
                      if (error) return alert("تعذّر الحذف: " + error.message);
                      setProjects((prev) => prev.filter((x) => x.id !== p.id));
                    }}
                    title="حذف البودكاست"
                    style={{ width: 36, padding: "8px 0", borderRadius: 8, border: "1px solid #F0D5D0", background: "#fff", color: "#A6402F", cursor: "pointer", fontSize: 15 }}>🗑</button>
                </div>
              </div>
              {playingId === p.id && audioUrls[p.id] && (
                <audio controls autoPlay src={audioUrls[p.id]} style={{ width: "100%", marginTop: 12 }} onClick={(e) => e.stopPropagation()} />
              )}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

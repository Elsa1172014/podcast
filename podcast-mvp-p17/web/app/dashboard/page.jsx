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
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace("/login");
      setUser(data.session.user);
      const { data: rows } = await supabase
        .from("projects")
        .select("id, title, status, created_at")
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
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>لوحة التحكم</h1>
          <p style={{ color: "#5B6F6C", margin: "4px 0 0" }}>{user?.email}</p>
        </div>
        <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #DCE4DF", background: "#fff", cursor: "pointer" }}>خروج</button>
      </div>

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
            <div key={p.id} onClick={() => router.push(`/project/${p.id}/script`)} style={{ padding: 16, background: "#fff", borderRadius: 10, border: "1px solid #DCE4DF", cursor: "pointer" }}>
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: "#5B6F6C" }}>{p.status}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async () => {
    setErr(""); setBusy(true);
    const supabase = createClient();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } },
      });
      setBusy(false);
      if (error) return setErr(error.message);
      setErr("تم إنشاء الحساب. تحقّق من بريدك لتأكيده، ثم سجّل الدخول.");
      setMode("login");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push("/dashboard");
  };

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>منصة إنتاج البودكاست</h1>
      <p style={{ color: "#5B6F6C", marginBottom: 24 }}>{mode === "login" ? "سجّل دخولك" : "أنشئ حسابًا جديدًا"}</p>

      {mode === "signup" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>الاسم الكامل</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={inp} />
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>البريد الإلكتروني</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>كلمة المرور</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
      </div>
      {err && <div style={{ color: "#A6402F", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <button disabled={busy} onClick={submit} style={btn}>
        {busy ? "جارٍ التنفيذ…" : mode === "login" ? "دخول" : "إنشاء الحساب"}
      </button>
      <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }} style={{ ...btn, background: "transparent", color: "#14746F", marginTop: 8 }}>
        {mode === "login" ? "ليس لديك حساب؟ أنشئ واحدًا" : "لديك حساب بالفعل؟ سجّل الدخول"}
      </button>
    </div>
  );
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DCE4DF", fontSize: 15, boxSizing: "border-box" };
const btn = { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#14746F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (active && data.session) setReady(true);
    };
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) setReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setMessage("");
    if (password.length < 8) return setError("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    if (password !== confirm) return setError("كلمتا المرور غير متطابقتين.");
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("انتهت صلاحية رابط الاستعادة. اطلب رابطًا جديدًا."); return; }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(updateError.message); return; }
      setMessage("تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.");
      setTimeout(() => router.replace("/login"), 1800);
    } catch {
      setError("تعذّر تغيير كلمة المرور. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DCE4DF", fontSize: 15, boxSizing: "border-box" };
  return (
    <main dir="rtl" style={{ maxWidth: 420, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>تعيين كلمة مرور جديدة</h1>
      {!ready && <p>افتح هذه الصفحة من رابط الاستعادة المرسل إلى بريدك. إذا انتهت صلاحيته، اطلب رابطًا جديدًا من صفحة الدخول.</p>}
      {ready && !message && (
        <form onSubmit={submit}>
          <label>كلمة المرور الجديدة</label>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inp, margin: "8px 0 16px" }} required minLength={8} />
          <label>تأكيد كلمة المرور</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ ...inp, margin: "8px 0 16px" }} required minLength={8} />
          <button type="submit" disabled={busy} style={{ ...inp, background: "#14746F", color: "#fff", cursor: "pointer" }}>{busy ? "جارٍ الحفظ…" : "تغيير كلمة المرور"}</button>
        </form>
      )}
      {error && <p role="alert" style={{ color: "#A6402F" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#14746F" }}>{message}</p>}
      <a href="/login" style={{ display: "block", marginTop: 20, color: "#14746F" }}>العودة إلى تسجيل الدخول</a>
    </main>
  );
}

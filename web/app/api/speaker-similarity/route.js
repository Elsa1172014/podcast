export const maxDuration = 60;
import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const { accessToken, originalBase64, generatedBase64 } = await req.json();
    if (!accessToken || !originalBase64 || !generatedBase64) {
      return Response.json({ error: "عينتا الصوت وجلسة المستخدم مطلوبة" }, { status: 400 });
    }
    if (originalBase64.length > 16000000 || generatedBase64.length > 16000000) {
      return Response.json({ error: "حجم العينة أكبر من المسموح" }, { status: 413 });
    }
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });
    if (!process.env.SPEAKER_SIMILARITY_URL || !process.env.SPEAKER_SERVICE_SECRET) {
      return Response.json({ available: false, error: "محرك بصمة المتحدث غير مفعّل على الخادم بعد." }, { status: 503 });
    }
    const url = new URL("/compare", process.env.SPEAKER_SIMILARITY_URL);
    if (url.protocol !== "https:") return Response.json({ error: "يجب استخدام HTTPS للخدمة" }, { status: 500 });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-speaker-secret": process.env.SPEAKER_SERVICE_SECRET },
      body: JSON.stringify({ originalBase64, generatedBase64 }),
      signal: AbortSignal.timeout(50000)
    });
    const result = await response.json();
    if (!response.ok) return Response.json({ error: result.detail || "تعذرت مقارنة بصمة المتحدث" }, { status: response.status });
    return Response.json(result);
  } catch {
    return Response.json({ error: "تعذّر الاتصال بخدمة بصمة المتحدث" }, { status: 502 });
  }
}

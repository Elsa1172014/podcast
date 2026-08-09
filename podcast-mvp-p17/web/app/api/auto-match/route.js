import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const { accessToken } = await req.json();
    if (!accessToken) return Response.json({ error: "جلسة مطلوبة" }, { status: 401 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) {
      return Response.json({ error: "لم يُضبَط اتصال الـWorker بعد." }, { status: 500 });
    }
    const workerRes = await fetch(`${process.env.WORKER_URL}/auto-match`, {
      method: "POST",
      headers: { "x-worker-secret": process.env.WORKER_SECRET },
    });
    const data = await workerRes.json();
    if (!workerRes.ok) return Response.json({ error: data.error || "فشلت المطابقة" }, { status: workerRes.status });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

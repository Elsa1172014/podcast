import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const { accessToken, voiceId } = await req.json();
    if (!accessToken || !voiceId) return Response.json({ error: "بيانات ناقصة" }, { status: 400 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) {
      return Response.json({ error: "لم يُضبَط اتصال الـWorker بعد." }, { status: 500 });
    }
    const workerRes = await fetch(`${process.env.WORKER_URL}/delete-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": process.env.WORKER_SECRET },
      body: JSON.stringify({ voiceId }),
    });
    const data = await workerRes.json();
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const { projectId, accessToken } = await req.json();
    if (!projectId || !accessToken) return Response.json({ error: "بيانات ناقصة" }, { status: 400 });

    // تحقّق أن المستخدم مسجَّل دخول فعليًّا ومالك هذا المشروع تحديدًا قبل
    // تشغيل أي معالجة قد تستهلك موارد أو تكلفة لاحقًا.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    const { data: project } = await supabase.from("projects").select("id, owner_id").eq("id", projectId).single();
    if (!project || project.owner_id !== userData.user.id) {
      return Response.json({ error: "لا صلاحية على هذا المشروع" }, { status: 403 });
    }

    if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) {
      return Response.json({ error: "لم يُضبَط اتصال الـWorker بعد في متغيّرات بيئة Vercel." }, { status: 500 });
    }

    const workerRes = await fetch(`${process.env.WORKER_URL}/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": process.env.WORKER_SECRET },
      body: JSON.stringify({ projectId }),
    });
    if (!workerRes.ok) {
      const t = await workerRes.text();
      return Response.json({ error: `الـWorker رفض الطلب: ${t}` }, { status: 502 });
    }
    return Response.json({ started: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

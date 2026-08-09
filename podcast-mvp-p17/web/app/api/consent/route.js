import { createClient } from "@supabase/supabase-js";

// يُسجَّل هذا من الخادم لا من المتصفح تحديدًا لسبب واحد: عنوان IP الحقيقي
// للطلب لا يمكن لكود المتصفح معرفته عن نفسه بشكل موثوق — الخادم وحده يراه
// في ترويسات الطلب الواردة.
export async function POST(req) {
  try {
    const { consentText, accessToken } = await req.json();
    if (!consentText || !accessToken) {
      return Response.json({ error: "بيانات ناقصة" }, { status: 400 });
    }

    // عميل يحمل نفس مفتاح الواجهة (anon/publishable) لكن بترويسة تفويض تحمل
    // جلسة المستخدم نفسه — هكذا تُقيَّم سياسات RLS بصفته هو لا بصفة مجهولة.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const { data, error } = await supabase
      .from("user_consents")
      .insert({
        user_id: userData.user.id,
        consent_text: consentText,
        ip_address: ip,
      })
      .select("id")
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ consentId: data.id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

import { createBrowserClient } from "@supabase/ssr";

// المفتاحان أدناه "publishable" لا "secret" — آمنان للظهور في المتصفح بتصميم
// Supabase نفسه (RLS هي خط الحماية الفعلي، لا إخفاء هذين المفتاحين).
// مفاتيح الخدمات الحساسة (ElevenLabs، مفتاح Supabase service_role) تبقى
// حصرًا في الـWorker، لا تُستورد هنا أبدًا.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

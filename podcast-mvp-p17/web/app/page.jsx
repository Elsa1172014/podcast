"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/dashboard" : "/login");
    });
  }, [router]);
  return <div style={{ padding: 40, textAlign: "center" }}>جارٍ التحميل…</div>;
}

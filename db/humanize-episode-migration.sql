-- ============================================================
-- ترقية: مسار الحلقة "المُعالَجة" (بعد فحص جودة حقيقي وتوحيد صوت)
-- شغّله مرة واحدة في SQL Editor → New Query
-- ============================================================

alter table projects
  add column if not exists humanized_audio_path text,
  add column if not exists humanized_at timestamptz,
  add column if not exists humanize_report jsonb; -- تقرير حقيقي: كم مقطعًا فُحص، كم أُعيد توليده، ولماذا

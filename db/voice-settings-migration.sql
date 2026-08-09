-- ============================================================
-- ترقية: إعدادات صوت قابلة للتخصيص لكل عينة (سرعة، تشابه، ثبات)
-- شغّله مرة واحدة في SQL Editor → New Query
-- ============================================================

alter table voice_samples
  add column if not exists settings jsonb not null default '{"speed": 1.0, "stability": 0.35, "similarity_boost": 1.0}'::jsonb;

-- يسمح لعينة أن تكون "جاهزة من مكتبة ElevenLabs" لا استنساخًا شخصيًّا —
-- voice_model_id في هذه الحالة معرّف صوت جاهز من مكتبتهم مباشرة، بلا
-- حاجة لملف مرفوع أو موافقة (source_type = 'preset' مدعوم أصلًا في القيد
-- الأصلي بجدول schema.sql).

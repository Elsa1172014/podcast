-- ============================================================
-- ترقية: مكتبة أصوات مدرسية مستقلة (لا تحتاج مشروعًا أو متحدثًا)
-- شغّله مرة واحدة في SQL Editor → New Query
-- تعديلات إضافية فقط — لا حذف لأي جدول أو بيانات موجودة.
-- ============================================================

-- الخطوة الأولى: اسمح لعينة صوت ألا تكون مرتبطة بمتحدث محدَّد (صوت مكتبة مستقل)
alter table voice_samples
  alter column speaker_id drop not null;

-- الخطوة الثانية: حقول جديدة لمكتبة الأصوات المستقلة
alter table voice_samples
  add column if not exists owner_id uuid references profiles(user_id),
  add column if not exists age_stage text,          -- المرحلة العمرية (مؤكَّدة من المستخدم)
  add column if not exists description text,        -- وصف اختياري للصوت
  add column if not exists analysis jsonb,           -- نتائج تحليل الصوت الأصلي (خاصيات حقيقية فقط)
  add column if not exists generated_analysis jsonb, -- نتائج تحليل الصوت المُولَّد للمقارنة
  add column if not exists match_pct integer;        -- نسبة التطابق الكلية المحفوظة عند الاعتماد

-- الخطوة الثالثة: سياسة وصول جديدة: مالك الصوت المستقل (owner_id) يدير صوته بلا حاجة
-- لمسار متحدث/مشروع — ضرورية لأن السياسة الأصلية تعتمد بالكامل على
-- speaker_id الذي أصبح اختياريًّا الآن.
create policy "voice_samples_owner_direct"
  on voice_samples for all
  using (owner_id = auth.uid() or is_admin(auth.uid()));

-- الخطوة الرابعة: سياسة قراءة: أي مستخدم مسجَّل يرى الأصوات "المعتمدة مدرسيًّا" —
-- هذا ما يجعلها مكتبة مشتركة فعليًّا بين كل المعلمين، لا حكرًا على من أنشأها.
create policy "voice_samples_read_approved_library"
  on voice_samples for select
  using (is_approved = true);

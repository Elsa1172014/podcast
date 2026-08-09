-- ============================================================
-- ترقية: إعدادات ضبط الصوت الكاملة + حالة الاعتماد
-- شغّله مرة واحدة في SQL Editor → New Query
-- ============================================================

alter table voice_samples
  add column if not exists voice_name text,
  add column if not exists generated_preview_url text,
  add column if not exists is_approved boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- ملاحظة تصميم مهمة: "التشابه" و"الوضوح" لدى ElevenLabs معامل واحد فعليًّا
-- (similarity_boost — توثيقهم يسمّيه "Clarity + Similarity Enhancement")،
-- فلا حقل clarity منفصلًا هنا عمدًا. "طبيعية الأداء" أيضًا لا معامل مستقل
-- لها لدى المزوّد (تتداخل مع stability)، فلا حقل naturalness — بدل ذلك
-- تبقى كل الإعدادات القابلة للتخصيص الفعلية داخل عمود settings (jsonb)
-- الموجود مسبقًا، بالمفاتيح: similarity, stability, style, speed, pitch,
-- volume, noise_reduction, echo_removal, speaker_boost, speaking_style.

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists voice_samples_updated_at on voice_samples;
create trigger voice_samples_updated_at
  before update on voice_samples
  for each row execute procedure set_updated_at();

-- ============================================================
-- إعداد تخزين عينات الصوت — شغّله مرة واحدة، منفصلًا عن schema.sql
-- من: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- دلو تخزين خاص (لا عام) — لا يُفتح أي ملف صوتي برابط مباشر بلا تحقّق هوية
insert into storage.buckets (id, name, public)
values ('voice-samples', 'voice-samples', false)
on conflict (id) do nothing;

-- سياسات الوصول: كل مستخدم يرفع/يقرأ/يحذف فقط داخل مجلده الخاص
-- (نتّبع تنظيم المسار: {user_id}/{project_id}/{speaker_id}/{ملف})
create policy "voice_samples_insert_own_folder"
  on storage.objects for insert
  with check (bucket_id = 'voice-samples' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "voice_samples_select_own_folder"
  on storage.objects for select
  using (bucket_id = 'voice-samples' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "voice_samples_delete_own_folder"
  on storage.objects for delete
  using (bucket_id = 'voice-samples' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- دلو الحلقات النهائية المُنتَجة ----------
insert into storage.buckets (id, name, public)
values ('episodes', 'episodes', false)
on conflict (id) do nothing;

create policy "episodes_insert_own_folder"
  on storage.objects for insert
  with check (bucket_id = 'episodes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "episodes_select_own_folder"
  on storage.objects for select
  using (bucket_id = 'episodes' and (storage.foldername(name))[1] = auth.uid()::text);

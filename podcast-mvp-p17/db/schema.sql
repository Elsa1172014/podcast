-- ============================================================
-- منصة إنتاج البودكاست — مخطط قاعدة البيانات الكامل (Supabase/Postgres)
-- شغّل هذا الملف كاملًا من: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

create extension if not exists "uuid-ossp";

-- ---------- profiles (يمتد جدول auth.users المُدار من Supabase) ----------
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'teacher' check (role in ('admin', 'teacher', 'student')),
  org_name text,
  created_at timestamptz not null default now()
);

-- إنشاء profile تلقائيًا عند تسجيل مستخدم جديد
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'مستخدم جديد'));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------- projects ----------
create table projects (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references profiles(user_id) on delete cascade,
  title text not null,
  topic text,
  language text not null default 'ar',
  episode_style text check (episode_style in ('dialogue', 'interview', 'story', 'report', 'debate', 'educational')),
  status text not null default 'draft' check (status in (
    'draft', 'script_ready', 'voice_setup', 'queued', 'processing',
    'preview_ready', 'revision_requested', 'completed', 'published', 'failed'
  )),
  progress_pct int not null default 0,
  final_audio_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- scripts (سيناريو واحد لكل مشروع) ----------
create table scripts (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null unique references projects(id) on delete cascade,
  raw_text text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------- speakers ----------
create table speakers (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- ---------- script_segments (المقاطع بعد تقسيم السيناريو) ----------
create table script_segments (
  id uuid primary key default uuid_generate_v4(),
  script_id uuid not null references scripts(id) on delete cascade,
  speaker_id uuid references speakers(id) on delete set null,
  order_index int not null,
  text text not null,
  tone_instruction text,
  created_at timestamptz not null default now()
);
create index idx_segments_script_order on script_segments(script_id, order_index);

-- ---------- user_consents (يجب إدراجه قبل voice_samples لأنها تُشير إليه) ----------
create table user_consents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  consent_text text not null,
  agreed_at timestamptz not null default now(),
  ip_address text
);

-- ---------- voice_samples ----------
create table voice_samples (
  id uuid primary key default uuid_generate_v4(),
  speaker_id uuid not null references speakers(id) on delete cascade,
  storage_path text not null,
  source_type text not null check (source_type in ('upload', 'record', 'preset')),
  consent_id uuid references user_consents(id),
  voice_model_id text, -- المعرّف الذي يعيده مزوّد استنساخ الصوت (ElevenLabs)
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);
-- قيد: عينة مستنسخة (upload/record) يجب أن تملك موافقة؛ الأصوات الجاهزة (preset) لا تحتاجها
alter table voice_samples add constraint consent_required_unless_preset
  check (source_type = 'preset' or consent_id is not null);

-- ---------- generated_audio_segments ----------
create table generated_audio_segments (
  id uuid primary key default uuid_generate_v4(),
  script_segment_id uuid not null references script_segments(id) on delete cascade,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  retry_count int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- music_tracks (مكتبة مشتركة، لا owner) ----------
create table music_tracks (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null check (category in ('intro', 'outro', 'background')),
  storage_path text not null,
  license_info text
);

-- ---------- sound_effects (جدول جاهز للمستقبل، خارج MVP الفعلي) ----------
create table sound_effects (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  storage_path text not null
);

-- ---------- automation_jobs ----------
create table automation_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  job_type text not null check (job_type in ('process_voice_sample', 'produce_episode', 'regenerate_segment')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- subscriptions (جدول جاهز، غير مفعَّل في MVP) ----------
create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references profiles(user_id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  renews_at timestamptz
);

-- ---------- usage_logs ----------
create table usage_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  action_type text not null,
  cost_estimate numeric(10,4) default 0,
  created_at timestamptz not null default now()
);

-- ---------- audit_logs ----------
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references profiles(user_id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  created_at timestamptz not null default now()
);

-- ============================================================
-- دالة مساعدة: هل المستخدم الحالي مدير؟
-- ============================================================
create function is_admin(uid uuid) returns boolean as $$
  select exists (select 1 from profiles where user_id = uid and role = 'admin');
$$ language sql security definer stable;

-- ============================================================
-- Row Level Security — تفعيل على كل جدول يخصّ مستخدمًا
-- ============================================================
alter table profiles enable row level security;
alter table projects enable row level security;
alter table scripts enable row level security;
alter table speakers enable row level security;
alter table script_segments enable row level security;
alter table voice_samples enable row level security;
alter table user_consents enable row level security;
alter table generated_audio_segments enable row level security;
alter table automation_jobs enable row level security;
alter table notifications enable row level security;
alter table subscriptions enable row level security;
alter table usage_logs enable row level security;
alter table audit_logs enable row level security;

-- profiles: كل مستخدم يرى ملفه فقط، أو المدير يرى الجميع
create policy "profiles_select_own_or_admin" on profiles
  for select using (user_id = auth.uid() or is_admin(auth.uid()));
create policy "profiles_update_own" on profiles
  for update using (user_id = auth.uid());

-- projects: المالك فقط، أو المدير
create policy "projects_all_own_or_admin" on projects
  for all using (owner_id = auth.uid() or is_admin(auth.uid()));

-- scripts: عبر ملكية المشروع المرتبط
create policy "scripts_all_via_project" on scripts
  for all using (
    exists (select 1 from projects p where p.id = scripts.project_id and (p.owner_id = auth.uid() or is_admin(auth.uid())))
  );

-- speakers: نفس المبدأ
create policy "speakers_all_via_project" on speakers
  for all using (
    exists (select 1 from projects p where p.id = speakers.project_id and (p.owner_id = auth.uid() or is_admin(auth.uid())))
  );

-- script_segments: عبر السيناريو → المشروع
create policy "segments_all_via_script" on script_segments
  for all using (
    exists (
      select 1 from scripts s join projects p on p.id = s.project_id
      where s.id = script_segments.script_id and (p.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

-- voice_samples: عبر المتحدث → المشروع
create policy "voice_samples_all_via_speaker" on voice_samples
  for all using (
    exists (
      select 1 from speakers sp join projects p on p.id = sp.project_id
      where sp.id = voice_samples.speaker_id and (p.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

-- user_consents: صاحب الموافقة فقط
create policy "consents_own_or_admin" on user_consents
  for all using (user_id = auth.uid() or is_admin(auth.uid()));

-- generated_audio_segments: عبر السلسلة الكاملة
create policy "generated_segments_via_chain" on generated_audio_segments
  for all using (
    exists (
      select 1 from script_segments ss join scripts s on s.id = ss.script_id join projects p on p.id = s.project_id
      where ss.id = generated_audio_segments.script_segment_id and (p.owner_id = auth.uid() or is_admin(auth.uid()))
    )
  );

-- automation_jobs: عبر المشروع
create policy "jobs_all_via_project" on automation_jobs
  for all using (
    exists (select 1 from projects p where p.id = automation_jobs.project_id and (p.owner_id = auth.uid() or is_admin(auth.uid())))
  );

-- notifications: صاحبها فقط
create policy "notifications_own" on notifications
  for all using (user_id = auth.uid());

-- subscriptions: صاحبها أو المدير
create policy "subscriptions_own_or_admin" on subscriptions
  for all using (user_id = auth.uid() or is_admin(auth.uid()));

-- usage_logs: صاحبها للقراءة، المدير للكل
create policy "usage_logs_own_or_admin" on usage_logs
  for select using (user_id = auth.uid() or is_admin(auth.uid()));

-- audit_logs: المدير فقط
create policy "audit_logs_admin_only" on audit_logs
  for select using (is_admin(auth.uid()));

-- music_tracks و sound_effects: مكتبة عامة، قراءة فقط لأي مستخدم مسجَّل
alter table music_tracks enable row level security;
alter table sound_effects enable row level security;
create policy "music_read_all" on music_tracks for select using (auth.uid() is not null);
create policy "sfx_read_all" on sound_effects for select using (auth.uid() is not null);

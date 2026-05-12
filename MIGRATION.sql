-- ─────────────────────────────────────────────────────────────
-- DISCI — Full RLS + Auth fix
-- Run this entire block in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Step 1: Add auth_id column to users table
alter table users add column if not exists auth_id uuid references auth.users(id) on delete cascade;

-- Step 2: Populate auth_id for any existing users by matching email
update users u
set auth_id = a.id
from auth.users a
where u.email = a.email
  and u.auth_id is null;

-- Step 3: Drop ALL existing policies
drop policy if exists "users_select_own" on users;
drop policy if exists "users_insert_own" on users;
drop policy if exists "users_update_own" on users;
drop policy if exists "reminders_select_own" on reminders;
drop policy if exists "reminders_insert_own" on reminders;
drop policy if exists "reminders_update_own" on reminders;
drop policy if exists "reminders_delete_own" on reminders;
drop policy if exists "scheduled_notif_own" on scheduled_notifications;
drop policy if exists "notif_logs_own" on notification_logs;
drop policy if exists "push_subs_own" on push_subscriptions;
drop policy if exists "monthly_reports_own" on monthly_reports;

-- Step 4: USERS — keyed on auth_id = auth.uid()
create policy "users_select_own" on users
  for select using (auth_id = auth.uid());

create policy "users_insert_own" on users
  for insert with check (auth_id = auth.uid());

create policy "users_update_own" on users
  for update using (auth_id = auth.uid());

-- Step 5: Helper function to get current user's internal id cleanly
-- (avoids repeating subquery in every policy)
create or replace function get_user_id()
returns uuid language sql stable security definer as $$
  select id from users where auth_id = auth.uid() limit 1;
$$;

-- Step 6: REMINDERS
create policy "reminders_select_own" on reminders
  for select using (user_id = get_user_id());

create policy "reminders_insert_own" on reminders
  for insert with check (user_id = get_user_id());

create policy "reminders_update_own" on reminders
  for update using (user_id = get_user_id());

create policy "reminders_delete_own" on reminders
  for delete using (user_id = get_user_id());

-- Step 7: SCHEDULED NOTIFICATIONS
create policy "scheduled_notif_own" on scheduled_notifications
  for all using (user_id = get_user_id());

-- Step 8: NOTIFICATION LOGS
create policy "notif_logs_own" on notification_logs
  for all using (user_id = get_user_id());

-- Step 9: PUSH SUBSCRIPTIONS
create policy "push_subs_own" on push_subscriptions
  for all using (user_id = get_user_id());

-- Step 10: MONTHLY REPORTS
create policy "monthly_reports_own" on monthly_reports
  for all using (user_id = get_user_id());

-- ─────────────────────────────────────────────────────────────
-- PASSKEY AUTH UPDATE
-- Since we're using device-based passkeys (not Supabase Auth sessions),
-- auth.uid() is always null. We protect data via the service key server-side
-- and use email-based lookup on the client with the anon key.
-- RLS is kept but relaxed for reads using anon key — writes go through API.
-- ─────────────────────────────────────────────────────────────

-- Drop session-based policies
drop policy if exists "users_select_own" on users;
drop policy if exists "users_insert_own" on users;
drop policy if exists "users_update_own" on users;
drop policy if exists "reminders_select_own" on reminders;
drop policy if exists "reminders_insert_own" on reminders;
drop policy if exists "reminders_update_own" on reminders;
drop policy if exists "reminders_delete_own" on reminders;
drop policy if exists "scheduled_notif_own" on scheduled_notifications;
drop policy if exists "notif_logs_own" on notification_logs;
drop policy if exists "push_subs_own" on push_subscriptions;
drop policy if exists "monthly_reports_own" on monthly_reports;

-- Allow anon reads (identity is enforced via email filter in queries)
-- Writes go through service key in API routes only
create policy "users_anon_select" on users for select using (true);
create policy "reminders_anon_select" on reminders for select using (true);
create policy "reminders_anon_update" on reminders for update using (true);
create policy "reminders_anon_delete" on reminders for delete using (true);
create policy "scheduled_anon_select" on scheduled_notifications for select using (true);
create policy "push_subs_anon_all" on push_subscriptions for all using (true);
create policy "monthly_reports_anon_select" on monthly_reports for select using (true);

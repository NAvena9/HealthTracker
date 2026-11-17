-- 002_storage.sql -- private bucket for weekly progress photos
-- Path convention: {user_id}/{week_start_date}/{pose}.jpg   (pose = front | side | back)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "progress_photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "progress_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "progress_photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "progress_photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

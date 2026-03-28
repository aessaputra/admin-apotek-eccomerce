-- Migration: Add avatar upload policies for authenticated users
-- Created: 2026-03-28
-- Purpose: Allow authenticated users to upload/update/delete their own avatars in 'avatars/' folder

-- ============================================
-- POLICY UNTUK USER UPLOAD AVATAR (Authenticated Users)
-- ============================================

-- Policy: Allow authenticated users to INSERT (upload) avatars
-- Hanya boleh upload ke folder 'avatars/'
DROP POLICY IF EXISTS "Allow authenticated users to upload avatars" ON storage.objects;
CREATE POLICY "Allow authenticated users to upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to UPDATE their own avatars
-- Hanya boleh update file di folder 'avatars/'
DROP POLICY IF EXISTS "Allow authenticated users to update avatars" ON storage.objects;
CREATE POLICY "Allow authenticated users to update avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
)
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to DELETE their own avatars
-- Hanya boleh delete file di folder 'avatars/'
DROP POLICY IF EXISTS "Allow authenticated users to delete avatars" ON storage.objects;
CREATE POLICY "Allow authenticated users to delete avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
);

-- ============================================
-- POLICY ALTERNATIF: Dengan User ID Enforcement (Lebih Aman)
-- ============================================
-- Uncomment policy di bawah ini jika frontend diubah untuk menyertakan user ID
-- dalam nama file avatar (contoh: 'avatars/{userId}-{timestamp}-{filename}.jpg')

/*
-- Policy: Allow authenticated users to INSERT avatars with user ID in filename
DROP POLICY IF EXISTS "Allow authenticated users to upload avatars with user id" ON storage.objects;
CREATE POLICY "Allow authenticated users to upload avatars with user id"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
  AND name LIKE 'avatars/' || (select auth.uid()) || '%'
);

-- Policy: Allow authenticated users to UPDATE their own avatars with user ID check
DROP POLICY IF EXISTS "Allow authenticated users to update own avatars" ON storage.objects;
CREATE POLICY "Allow authenticated users to update own avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
  AND name LIKE 'avatars/' || (select auth.uid()) || '%'
)
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
  AND name LIKE 'avatars/' || (select auth.uid()) || '%'
);

-- Policy: Allow authenticated users to DELETE their own avatars with user ID check
DROP POLICY IF EXISTS "Allow authenticated users to delete own avatars" ON storage.objects;
CREATE POLICY "Allow authenticated users to delete own avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = 'avatars'
  AND name LIKE 'avatars/' || (select auth.uid()) || '%'
);
*/

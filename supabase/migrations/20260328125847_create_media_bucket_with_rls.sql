-- Migration: Create media bucket with RLS policies
-- Created: 2026-03-28
-- Purpose: Unify all image storage into single media bucket with path-based organization

-- Create the 'media' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS on storage.objects (idempotent)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public/anonymous SELECT (read) access to media bucket
DROP POLICY IF EXISTS "Allow public read access on media bucket" ON storage.objects;
CREATE POLICY "Allow public read access on media bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'media');

-- Policy: Allow admin users to INSERT into media bucket
DROP POLICY IF EXISTS "Allow admin inserts on media bucket" ON storage.objects;
CREATE POLICY "Allow admin inserts on media bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

-- Policy: Allow admin users to UPDATE objects in media bucket
DROP POLICY IF EXISTS "Allow admin updates on media bucket" ON storage.objects;
CREATE POLICY "Allow admin updates on media bucket"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

-- Policy: Allow admin users to DELETE objects in media bucket
DROP POLICY IF EXISTS "Allow admin deletes on media bucket" ON storage.objects;
CREATE POLICY "Allow admin deletes on media bucket"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

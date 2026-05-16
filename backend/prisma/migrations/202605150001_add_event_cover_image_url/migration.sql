ALTER TABLE ticketing.events
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

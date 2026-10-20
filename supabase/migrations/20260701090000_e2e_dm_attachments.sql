ALTER TABLE public.direct_message_attachments
  ADD COLUMN IF NOT EXISTS encryption_metadata jsonb;

CREATE INDEX IF NOT EXISTS direct_message_attachments_encryption_metadata_idx
  ON public.direct_message_attachments USING gin (encryption_metadata)
  WHERE encryption_metadata IS NOT NULL;

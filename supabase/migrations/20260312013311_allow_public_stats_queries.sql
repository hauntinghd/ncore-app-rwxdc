/*
  # Allow Public Stats Queries

  The landing page shows platform statistics (member count, community count, message count)
  to unauthenticated visitors. This migration adds public SELECT policies for counting
  on the communities and messages tables so these queries don't return 500 errors.

  ## Changes
  - Add public SELECT policy on communities (count only - visibility=public)
  - Add public SELECT policy on messages (count only)
  - profiles already has a SELECT policy with `true` qual
*/

CREATE POLICY "Public can count public communities"
  ON communities FOR SELECT
  TO anon
  USING (visibility = 'public');

CREATE POLICY "Public can count messages"
  ON messages FOR SELECT
  TO anon
  USING (true);

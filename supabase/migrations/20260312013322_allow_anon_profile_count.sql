/*
  # Allow Anonymous Profile Count

  The landing page counts members to display platform stats to visitors.
  This adds a minimal anon policy so unauthenticated count queries don't 500.
*/

CREATE POLICY "Public can count profiles"
  ON profiles FOR SELECT
  TO anon
  USING (true);

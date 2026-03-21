/*
  # Ensure community owners always retain customization access
*/

DROP POLICY IF EXISTS "Community customization visible to members" ON public.community_server_customizations;
CREATE POLICY "Community customization visible to members"
  ON public.community_server_customizations
  FOR SELECT
  TO authenticated
  USING (
    public.is_community_member(community_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_server_customizations.community_id
        AND c.owner_id = auth.uid()
    )
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization insert by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization insert by admins"
  ON public.community_server_customizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_server_customizations.community_id
        AND c.owner_id = auth.uid()
    )
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization update by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization update by admins"
  ON public.community_server_customizations
  FOR UPDATE
  TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_server_customizations.community_id
        AND c.owner_id = auth.uid()
    )
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_server_customizations.community_id
        AND c.owner_id = auth.uid()
    )
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization delete by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization delete by admins"
  ON public.community_server_customizations
  FOR DELETE
  TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_server_customizations.community_id
        AND c.owner_id = auth.uid()
    )
    OR public.is_platform_admin(auth.uid())
  );

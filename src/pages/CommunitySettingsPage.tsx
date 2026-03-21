import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Palette, Plus, Save, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, UserX } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Community, CommunityMember, CommunityRole, Profile, Visibility } from '../lib/types';

type VerificationLevel = 'none' | 'low' | 'medium' | 'high' | 'very_high';

interface CommunityCustomizationRow {
  community_id: string;
  accent_color: string;
  gradient_start: string;
  gradient_end: string;
  server_tagline: string;
  welcome_message: string;
  rules_markdown: string;
  onboarding_steps: string[];
  default_slowmode_seconds: number;
  max_upload_mb: number;
  verification_level: VerificationLevel;
  custom_role_labels: Record<string, string>;
  custom_theme_css: string;
  enable_animated_background: boolean;
  invite_only: boolean;
}

interface RoleLabelRow {
  id: string;
  key: string;
  label: string;
}

interface CommunityInviteRow {
  id: string;
  community_id: string;
  code: string;
  created_by: string | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}

const DEFAULT_CUSTOMIZATION: CommunityCustomizationRow = {
  community_id: '',
  accent_color: '#00c8ff',
  gradient_start: '#0b1220',
  gradient_end: '#192338',
  server_tagline: '',
  welcome_message: '',
  rules_markdown: '',
  onboarding_steps: ['Read the rules', 'Introduce yourself', 'Pick your roles'],
  default_slowmode_seconds: 0,
  max_upload_mb: 10240,
  verification_level: 'low',
  custom_role_labels: {
    owner: 'Owner',
    admin: 'Admin',
    moderator: 'Moderator',
    member: 'Member',
  },
  custom_theme_css: '',
  enable_animated_background: true,
  invite_only: false,
};

function createRoleRows(labels: Record<string, string>): RoleLabelRow[] {
  const entries = Object.entries(labels || {});
  if (entries.length === 0) {
    return [{ id: `role-${Date.now()}-0`, key: 'member', label: 'Member' }];
  }
  return entries.map(([key, label], index) => ({
    id: `role-${Date.now()}-${index}`,
    key,
    label,
  }));
}

function buildRoleLabels(rows: RoleLabelRow[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  rows.forEach((row) => {
    const key = row.key.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const label = row.label.trim();
    if (!key || !label) return;
    mapped[key] = label;
  });
  return mapped;
}

export function CommunitySettingsPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [community, setCommunity] = useState<Community | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [deletingCommunity, setDeletingCommunity] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [iconUrl, setIconUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [customization, setCustomization] = useState<CommunityCustomizationRow>(DEFAULT_CUSTOMIZATION);
  const [roleLabels, setRoleLabels] = useState<RoleLabelRow[]>(
    createRoleRows(DEFAULT_CUSTOMIZATION.custom_role_labels)
  );
  const [onboardingStepsText, setOnboardingStepsText] = useState(DEFAULT_CUSTOMIZATION.onboarding_steps.join('\n'));
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);
  const [inviteRows, setInviteRows] = useState<CommunityInviteRow[]>([]);
  const [inviteActionLoading, setInviteActionLoading] = useState(false);
  const [inviteMaxUses, setInviteMaxUses] = useState('0');
  const [inviteExpiresDays, setInviteExpiresDays] = useState('7');
  const [inviteMessage, setInviteMessage] = useState('');

  function getMemberProfile(member: CommunityMember): Profile | null {
    const raw = member as any;
    return (raw.profile || raw.profiles || null) as Profile | null;
  }

  function memberRoleLabel(role: CommunityRole): string {
    const labels = customization.custom_role_labels || {};
    return labels[role] || role;
  }

  function buildInviteLink(code: string): string {
    const origin = window.location.origin;
    return `${origin}/app/community/${communityId}?invite=${encodeURIComponent(code)}`;
  }

  async function loadMembers(targetCommunityId: string): Promise<CommunityMember[]> {
    const { data: memberRows } = await supabase
      .from('community_members')
      .select('*')
      .eq('community_id', targetCommunityId)
      .order('joined_at', { ascending: true });

    const rows = (memberRows || []) as CommunityMember[];
    const missingProfileIds = Array.from(
      new Set(
        rows
          .filter((member: any) => !member.profile && !member.profiles && member.user_id)
          .map((member) => member.user_id),
      ),
    );

    if (missingProfileIds.length === 0) return rows;

    const { data: profileRows } = await supabase
      .from('profiles')
      .select('*')
      .in('id', missingProfileIds);
    const profileById = new Map((profileRows || []).map((profile: any) => [String(profile.id), profile]));
    return rows.map((member: any) => ({
      ...member,
      profile: member.profile || member.profiles || profileById.get(String(member.user_id)) || null,
    })) as CommunityMember[];
  }

  async function loadInvites(targetCommunityId: string): Promise<CommunityInviteRow[]> {
    const { data } = await supabase
      .from('community_invites')
      .select('*')
      .eq('community_id', targetCommunityId)
      .order('created_at', { ascending: false });
    return (data || []) as CommunityInviteRow[];
  }

  useEffect(() => {
    if (!communityId || !profile) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');

      const [communityRes, memberRes, customizationRes, memberListRes, inviteListRes] = await Promise.all([
        supabase.from('communities').select('*').eq('id', communityId).maybeSingle(),
        supabase
          .from('community_members')
          .select('role')
          .eq('community_id', communityId)
          .eq('user_id', profile.id)
          .maybeSingle(),
        supabase
          .from('community_server_customizations')
          .select('*')
          .eq('community_id', communityId)
          .maybeSingle(),
        supabase
          .from('community_members')
          .select('*')
          .eq('community_id', communityId)
          .order('joined_at', { ascending: true }),
        supabase
          .from('community_invites')
          .select('*')
          .eq('community_id', communityId)
          .order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      if (!communityRes.data) {
        setError('Community not found.');
        setLoading(false);
        return;
      }

      const nextCommunity = communityRes.data as Community;
      const adminAllowed =
        nextCommunity.owner_id === profile.id
        || ['owner', 'admin'].includes(String((memberRes.data as any)?.role || ''))
        || profile.platform_role === 'owner';

      if (!adminAllowed) {
        navigate(`/app/community/${communityId}`);
        return;
      }

      setCommunity(nextCommunity);
      setIsAdmin(true);
      setName(nextCommunity.name || '');
      setDescription(nextCommunity.description || '');
      setCategory(nextCommunity.category || 'General');
      setVisibility((nextCommunity.visibility || 'public') as Visibility);
      setIconUrl(nextCommunity.icon_url || '');
      setBannerUrl(nextCommunity.banner_url || '');

      const loadedCustomization = customizationRes.data as CommunityCustomizationRow | null;
      const merged = {
        ...DEFAULT_CUSTOMIZATION,
        ...(loadedCustomization || {}),
        community_id: communityId,
        onboarding_steps: Array.isArray(loadedCustomization?.onboarding_steps)
          ? loadedCustomization!.onboarding_steps
          : DEFAULT_CUSTOMIZATION.onboarding_steps,
        custom_role_labels:
          loadedCustomization?.custom_role_labels && typeof loadedCustomization.custom_role_labels === 'object'
            ? loadedCustomization.custom_role_labels
            : DEFAULT_CUSTOMIZATION.custom_role_labels,
      };

      const memberRows = (memberListRes.data || []) as CommunityMember[];
      const missingProfileIds = Array.from(
        new Set(
          memberRows
            .filter((member: any) => !member.profile && !member.profiles && member.user_id)
            .map((member) => member.user_id),
        ),
      );

      let hydratedMembers = memberRows;
      if (missingProfileIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('*')
          .in('id', missingProfileIds);
        if (!cancelled && profileRows) {
          const profileById = new Map((profileRows as any[]).map((profile) => [String(profile.id), profile]));
          hydratedMembers = memberRows.map((member: any) => ({
            ...member,
            profile: member.profile || member.profiles || profileById.get(String(member.user_id)) || null,
          })) as CommunityMember[];
        }
      }

      setCustomization(merged);
      setOnboardingStepsText((merged.onboarding_steps || []).join('\n'));
      setRoleLabels(createRoleRows(merged.custom_role_labels || DEFAULT_CUSTOMIZATION.custom_role_labels));
      setMembers(hydratedMembers);
      setInviteRows((inviteListRes.data || []) as CommunityInviteRow[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [communityId, navigate, profile]);

  const previewGradient = useMemo(() => {
    return `linear-gradient(135deg, ${customization.gradient_start}, ${customization.gradient_end})`;
  }, [customization.gradient_start, customization.gradient_end]);

  function updateRoleLabel(id: string, patch: Partial<Pick<RoleLabelRow, 'key' | 'label'>>) {
    setRoleLabels((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRoleLabelRow() {
    setRoleLabels((prev) => [
      ...prev,
      { id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, key: '', label: '' },
    ]);
  }

  function removeRoleLabelRow(id: string) {
    setRoleLabels((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== id);
    });
  }

  async function handleSave() {
    if (!community || !communityId || !isAdmin) return;
    setSaving(true);
    setSaved(false);
    setError('');

    const nextOnboardingSteps = onboardingStepsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 25);
    const nextRoleLabels = buildRoleLabels(roleLabels);

    const { error: updateCommunityError } = await supabase
      .from('communities')
      .update({
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || 'General',
        visibility,
        icon_url: iconUrl.trim() || null,
        banner_url: bannerUrl.trim() || null,
      } as any)
      .eq('id', communityId);

    if (updateCommunityError) {
      setError(updateCommunityError.message);
      setSaving(false);
      return;
    }

    const payload = {
      ...customization,
      community_id: communityId,
      server_tagline: customization.server_tagline.trim(),
      welcome_message: customization.welcome_message.trim(),
      rules_markdown: customization.rules_markdown.trim(),
      onboarding_steps: nextOnboardingSteps,
      custom_role_labels: Object.keys(nextRoleLabels).length > 0 ? nextRoleLabels : DEFAULT_CUSTOMIZATION.custom_role_labels,
      custom_theme_css: customization.custom_theme_css.trim(),
    };

    const { error: customizationError } = await supabase
      .from('community_server_customizations')
      .upsert(payload as any, { onConflict: 'community_id' });

    if (customizationError) {
      setError(customizationError.message);
      setSaving(false);
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setSaving(false);
  }

  async function handleCommunityAssetUpload(
    kind: 'icon' | 'banner',
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file || !profile || !communityId) return;

    const maxSize = kind === 'icon' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError(`${kind === 'icon' ? 'Icon' : 'Banner'} image must be under ${kind === 'icon' ? '5MB' : '10MB'}.`);
      event.target.value = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported.');
      event.target.value = '';
      return;
    }

    setError('');
    if (kind === 'icon') setUploadingIcon(true);
    else setUploadingBanner(true);

    try {
      const ext = String(file.name.split('.').pop() || 'webp').toLowerCase();
      const storagePath = `${profile.id}/communities/${communityId}/${kind}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('community-assets')
        .upload(storagePath, file, { upsert: true });
      if (uploadError) {
        setError(`Failed to upload ${kind}: ${uploadError.message}`);
        return;
      }

      const { data: publicData } = supabase.storage.from('community-assets').getPublicUrl(storagePath);
      const nextUrl = publicData.publicUrl;
      if (kind === 'icon') setIconUrl(nextUrl);
      else setBannerUrl(nextUrl);

      const payload = kind === 'icon'
        ? { icon_url: nextUrl }
        : { banner_url: nextUrl };
      const { error: persistError } = await supabase
        .from('communities')
        .update(payload as any)
        .eq('id', communityId);
      if (persistError) {
        setError(`Uploaded ${kind}, but failed to save it on the server: ${persistError.message}`);
        return;
      }

      setCommunity((prev) => {
        if (!prev) return prev;
        return kind === 'icon'
          ? { ...prev, icon_url: nextUrl }
          : { ...prev, banner_url: nextUrl };
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      if (kind === 'icon') setUploadingIcon(false);
      else setUploadingBanner(false);
      event.target.value = '';
    }
  }

  function createInviteCode() {
    const token = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36).slice(-4);
    return `${token}${stamp}`.toUpperCase();
  }

  async function handleCreateInvite() {
    if (!communityId || !community) return;
    setInviteActionLoading(true);
    setInviteMessage('');
    setError('');
    try {
      const maxUses = Math.max(Number(inviteMaxUses || 0), 0);
      const expiresDays = Math.max(Number(inviteExpiresDays || 0), 0);
      const expiresAt = expiresDays > 0
        ? new Date(Date.now() + (expiresDays * 24 * 60 * 60 * 1000)).toISOString()
        : null;

      const { data, error: insertError } = await supabase
        .from('community_invites')
        .insert({
          community_id: communityId,
          code: createInviteCode(),
          max_uses: maxUses > 0 ? maxUses : null,
          expires_at: expiresAt,
          created_by: profile?.id || null,
        } as any)
        .select('*')
        .maybeSingle();

      if (insertError || !data) {
        setError(insertError?.message || 'Could not create invite.');
        return;
      }

      const refreshed = await loadInvites(String(communityId || ''));
      setInviteRows(refreshed.length > 0 ? refreshed : [data as CommunityInviteRow]);
      const link = buildInviteLink(String((data as CommunityInviteRow).code || ''));
      try {
        await navigator.clipboard.writeText(link);
        setInviteMessage('Invite created and copied to clipboard.');
      } catch {
        setInviteMessage(`Invite created: ${link}`);
      }
    } finally {
      setInviteActionLoading(false);
    }
  }

  async function handleCopyInvite(code: string) {
    const link = buildInviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
      setInviteMessage('Invite link copied.');
    } catch {
      setInviteMessage(link);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    setInviteActionLoading(true);
    setInviteMessage('');
    setError('');
    try {
      const { error: revokeError } = await supabase
        .from('community_invites')
        .update({ revoked: true } as any)
        .eq('id', inviteId);
      if (revokeError) {
        setError(revokeError.message);
        return;
      }
      const refreshed = await loadInvites(String(communityId || ''));
      setInviteRows(refreshed);
      setInviteMessage('Invite revoked.');
    } finally {
      setInviteActionLoading(false);
    }
  }

  async function handleMemberRoleUpdate(targetUserId: string, nextRole: CommunityRole) {
    if (!communityId || !community || !profile) return;
    if (targetUserId === community.owner_id) return;
    if (targetUserId === profile.id) return;
    setMemberActionUserId(targetUserId);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('community_members')
        .update({ role: nextRole } as any)
        .eq('community_id', communityId)
        .eq('user_id', targetUserId);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      const refreshed = await loadMembers(communityId);
      setMembers(refreshed);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    if (!communityId || !community || !profile) return;
    if (targetUserId === community.owner_id) return;
    if (targetUserId === profile.id) return;
    const target = members.find((member) => member.user_id === targetUserId);
    const targetProfile = target ? getMemberProfile(target) : null;
    const targetName = targetProfile?.display_name || targetProfile?.username || 'this member';
    const confirmed = window.confirm(`Remove ${targetName} from ${community.name}?`);
    if (!confirmed) return;

    setMemberActionUserId(targetUserId);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('community_members')
        .delete()
        .eq('community_id', communityId)
        .eq('user_id', targetUserId);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
      const refreshed = await loadMembers(communityId);
      setMembers(refreshed);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleTransferOwnership(targetUserId: string) {
    if (!communityId || !community || !profile) return;
    if (community.owner_id !== profile.id && profile.platform_role !== 'owner') return;
    if (targetUserId === community.owner_id) return;
    const target = members.find((member) => member.user_id === targetUserId);
    const targetProfile = target ? getMemberProfile(target) : null;
    const targetName = targetProfile?.display_name || targetProfile?.username || 'this member';
    const confirmed = window.confirm(`Transfer ownership to ${targetName}?`);
    if (!confirmed) return;

    setMemberActionUserId(targetUserId);
    setError('');
    try {
      const { error: transferError } = await supabase.rpc('transfer_community_ownership', {
        p_community_id: communityId,
        p_target_user_id: targetUserId,
      });
      if (transferError) {
        setError(transferError.message);
        return;
      }
      setCommunity((prev) => (prev ? { ...prev, owner_id: targetUserId } : prev));
      const refreshed = await loadMembers(communityId);
      setMembers(refreshed);
    } finally {
      setMemberActionUserId(null);
    }
  }

  const isCommunityOwner = Boolean(
    community && profile && (community.owner_id === profile.id || profile.platform_role === 'owner'),
  );
  const canDeleteCommunity = Boolean(
    community && profile && (community.owner_id === profile.id || profile.platform_role === 'owner'),
  );

  async function handleDeleteCommunity() {
    if (!communityId || !community || !profile) return;
    if (!canDeleteCommunity) {
      setError('Only the server owner can delete this server.');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${community.name}" forever? This removes channels, messages, invites, and settings.`,
    );
    if (!confirmed) return;
    const finalConfirmed = window.confirm(
      `Final confirmation: permanently delete "${community.name}" now?`,
    );
    if (!finalConfirmed) return;

    setDeletingCommunity(true);
    setError('');

    try {
      const { error: deleteError } = await supabase.rpc('delete_owned_community', {
        p_community_id: communityId,
      });

      if (deleteError) {
        const normalizedCode = String((deleteError as any)?.code || '').toUpperCase();
        const normalizedMessage = String(deleteError.message || '').toLowerCase();
        const isMissingDeleteRpc = normalizedCode === 'PGRST202'
          || normalizedMessage.includes('delete_owned_community')
          || normalizedMessage.includes('could not find the function');

        if (!isMissingDeleteRpc) {
          setError(deleteError.message || 'Could not delete this server.');
          return;
        }

        let fallbackDeleteQuery: any = supabase.from('communities').delete().eq('id', communityId);
        if (profile.platform_role !== 'owner') {
          fallbackDeleteQuery = fallbackDeleteQuery.eq('owner_id', profile.id);
        }

        const { error: fallbackDeleteError } = await fallbackDeleteQuery;
        if (fallbackDeleteError) {
          setError(
            `Delete failed. RPC missing and direct delete fallback failed: ${fallbackDeleteError.message || 'Unknown error.'}`,
          );
          return;
        }
      }

      navigate('/app/discover');
    } finally {
      setDeletingCommunity(false);
    }
  }

  if (loading) {
    return (
      <AppShell showChannelSidebar={false} title="Server Settings">
        <div className="h-full flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!community || !isAdmin) {
    return (
      <AppShell showChannelSidebar={false} title="Server Settings">
        <div className="h-full flex items-center justify-center text-surface-400">You do not have access to these settings.</div>
      </AppShell>
    );
  }

  return (
    <AppShell activeCommunityId={communityId} showChannelSidebar={false} title={`${community.name} Settings`}>
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              Server customization saved.
            </div>
          )}

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Server Identity</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} className="nyptid-input mt-1" maxLength={80} />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Category
                <input value={category} onChange={(e) => setCategory(e.target.value)} className="nyptid-input mt-1" maxLength={48} />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide md:col-span-2">
                Description
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="nyptid-input mt-1 resize-none" rows={3} maxLength={500} />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Server Icon
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    void handleCommunityAssetUpload('icon', event);
                  }}
                />
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    disabled={uploadingIcon}
                    className="nyptid-btn-secondary h-10 px-3"
                  >
                    <Upload size={13} />
                    {uploadingIcon ? 'Uploading...' : 'Choose Image'}
                  </button>
                  {iconUrl && (
                    <img src={iconUrl} alt="Server icon" className="w-10 h-10 rounded-lg object-cover border border-surface-700" />
                  )}
                </div>
                <div className="mt-1 text-[11px] normal-case text-surface-500">JPG, PNG, GIF, WEBP. Max 5MB.</div>
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Server Banner
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    void handleCommunityAssetUpload('banner', event);
                  }}
                />
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    disabled={uploadingBanner}
                    className="nyptid-btn-secondary h-10 px-3"
                  >
                    <Upload size={13} />
                    {uploadingBanner ? 'Uploading...' : 'Choose Image'}
                  </button>
                </div>
                {bannerUrl && (
                  <img src={bannerUrl} alt="Server banner" className="mt-2 h-16 w-full rounded-lg object-cover border border-surface-700" />
                )}
                <div className="mt-1 text-[11px] normal-case text-surface-500">JPG, PNG, GIF, WEBP. Max 10MB.</div>
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Visibility
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} className="nyptid-input mt-1">
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Join Access
                <select
                  value={customization.invite_only ? 'invite_only' : 'open'}
                  onChange={(event) => setCustomization((prev) => ({ ...prev, invite_only: event.target.value === 'invite_only' }))}
                  className="nyptid-input mt-1"
                >
                  <option value="open">Open Join</option>
                  <option value="invite_only">Invite Only</option>
                </select>
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Server Tagline
                <input
                  value={customization.server_tagline}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, server_tagline: e.target.value }))}
                  className="nyptid-input mt-1"
                  maxLength={140}
                />
              </label>
            </div>
          </div>

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Copy size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Invites & Join Access</h2>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-surface-300">
                {customization.invite_only
                  ? 'This server is invite-only. Public listing is allowed, but users must join using an invite code.'
                  : 'This server is open join. Anyone can join from the server page/discovery.'}
              </div>
              <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3">
                <label className="text-xs text-surface-500 uppercase tracking-wide">
                  Max Uses (0 = unlimited)
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={inviteMaxUses}
                    onChange={(event) => setInviteMaxUses(event.target.value)}
                    className="nyptid-input mt-1"
                  />
                </label>
                <label className="text-xs text-surface-500 uppercase tracking-wide">
                  Expires In Days (0 = never)
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={inviteExpiresDays}
                    onChange={(event) => setInviteExpiresDays(event.target.value)}
                    className="nyptid-input mt-1"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateInvite();
                    }}
                    disabled={inviteActionLoading}
                    className="nyptid-btn-secondary h-10"
                  >
                    <Plus size={14} />
                    {inviteActionLoading ? 'Creating...' : 'Create Invite'}
                  </button>
                </div>
              </div>

              {inviteMessage && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {inviteMessage}
                </div>
              )}

              <div className="space-y-2">
                {inviteRows.length === 0 ? (
                  <div className="text-xs text-surface-500">No invite links created yet.</div>
                ) : inviteRows.map((invite) => {
                  const expiryLabel = invite.expires_at ? new Date(invite.expires_at).toLocaleString() : 'Never';
                  const usesLabel = invite.max_uses ? `${invite.use_count}/${invite.max_uses}` : `${invite.use_count}/unlimited`;
                  return (
                    <div key={invite.id} className="rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-surface-200 truncate">{invite.code}</div>
                        <div className="text-xs text-surface-500 mt-0.5">
                          Uses: {usesLabel} · Expires: {expiryLabel} {invite.revoked ? '· Revoked' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleCopyInvite(invite.code);
                        }}
                        className="nyptid-btn-secondary px-3 py-1.5 text-xs"
                      >
                        Copy
                      </button>
                      {!invite.revoked && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleRevokeInvite(invite.id);
                          }}
                          disabled={inviteActionLoading}
                          className="nyptid-btn-secondary px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Brand & Visuals</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Accent
                <input
                  type="color"
                  value={customization.accent_color}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, accent_color: e.target.value }))}
                  className="mt-1 h-10 w-full rounded border border-surface-700 bg-surface-900"
                />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Gradient Start
                <input
                  type="color"
                  value={customization.gradient_start}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, gradient_start: e.target.value }))}
                  className="mt-1 h-10 w-full rounded border border-surface-700 bg-surface-900"
                />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Gradient End
                <input
                  type="color"
                  value={customization.gradient_end}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, gradient_end: e.target.value }))}
                  className="mt-1 h-10 w-full rounded border border-surface-700 bg-surface-900"
                />
              </label>
            </div>

            <div className="rounded-xl border border-surface-700 p-4" style={{ background: previewGradient }}>
              <div className="text-xs text-surface-300 uppercase tracking-wide">Preview</div>
              <div className="mt-1 text-xl font-black" style={{ color: customization.accent_color }}>
                {community.name}
              </div>
              <div className="text-sm text-surface-200 mt-1">{customization.server_tagline || 'Set a custom tagline for your server.'}</div>
            </div>

            <label className="mt-4 block text-xs text-surface-500 uppercase tracking-wide">
              Custom Theme CSS (Advanced)
              <textarea
                value={customization.custom_theme_css}
                onChange={(e) => setCustomization((prev) => ({ ...prev, custom_theme_css: e.target.value }))}
                className="nyptid-input mt-1 resize-y font-mono text-xs"
                rows={4}
                placeholder="/* Optional custom CSS overrides for themed surfaces */"
              />
            </label>
          </div>

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Moderation & Limits</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Verification Level
                <select
                  value={customization.verification_level}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, verification_level: e.target.value as VerificationLevel }))}
                  className="nyptid-input mt-1"
                >
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="very_high">Very High</option>
                </select>
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Default Slowmode (seconds)
                <input
                  type="number"
                  min={0}
                  max={21600}
                  value={customization.default_slowmode_seconds}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, default_slowmode_seconds: Number(e.target.value || 0) }))}
                  className="nyptid-input mt-1"
                />
              </label>
              <label className="text-xs text-surface-500 uppercase tracking-wide">
                Max Upload (MB)
                <input
                  type="number"
                  min={1}
                  max={10240}
                  value={customization.max_upload_mb}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, max_upload_mb: Number(e.target.value || 1) }))}
                  className="nyptid-input mt-1"
                />
              </label>
            </div>
          </div>

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <SlidersHorizontal size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Onboarding & Roles</h2>
            </div>
            <div className="space-y-4">
              <label className="block text-xs text-surface-500 uppercase tracking-wide">
                Welcome Message
                <textarea
                  value={customization.welcome_message}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, welcome_message: e.target.value }))}
                  className="nyptid-input mt-1 resize-none"
                  rows={3}
                />
              </label>
              <label className="block text-xs text-surface-500 uppercase tracking-wide">
                Rules / Long Description
                <textarea
                  value={customization.rules_markdown}
                  onChange={(e) => setCustomization((prev) => ({ ...prev, rules_markdown: e.target.value }))}
                  className="nyptid-input mt-1 resize-y"
                  rows={6}
                  placeholder="Use markdown-style formatting for server rules and structure."
                />
              </label>
              <label className="block text-xs text-surface-500 uppercase tracking-wide">
                Onboarding Steps (one per line)
                <textarea
                  value={onboardingStepsText}
                  onChange={(e) => setOnboardingStepsText(e.target.value)}
                  className="nyptid-input mt-1 resize-y"
                  rows={4}
                />
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="block text-xs text-surface-500 uppercase tracking-wide">
                    Server Roles
                  </span>
                  <button
                    type="button"
                    onClick={addRoleLabelRow}
                    className="nyptid-btn-secondary px-2.5 py-1.5 text-xs"
                  >
                    <Plus size={12} />
                    Add Role
                  </button>
                </div>
                <div className="space-y-2">
                  {roleLabels.map((row) => (
                    <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
                      <input
                        value={row.key}
                        onChange={(event) => updateRoleLabel(row.id, { key: event.target.value })}
                        className="nyptid-input font-mono text-xs"
                        placeholder="role-key (e.g. server-booster)"
                        maxLength={40}
                      />
                      <input
                        value={row.label}
                        onChange={(event) => updateRoleLabel(row.id, { label: event.target.value })}
                        className="nyptid-input"
                        placeholder="Display label (e.g. Server Booster)"
                        maxLength={48}
                      />
                      <button
                        type="button"
                        onClick={() => removeRoleLabelRow(row.id)}
                        disabled={roleLabels.length <= 1}
                        className="nyptid-btn-secondary h-10 w-10 p-0"
                        title="Remove role"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-surface-500">
                  Roles are saved server-wide. Keys are normalized to lowercase and used internally.
                </p>
              </div>
            </div>
          </div>

          <div className="nyptid-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={16} className="text-nyptid-300" />
              <h2 className="text-lg font-bold text-surface-100">Member Moderation</h2>
            </div>
            <div className="space-y-2">
              {members.length === 0 && (
                <div className="text-xs text-surface-500">No members found.</div>
              )}
              {members.map((member) => {
                const memberProfile = getMemberProfile(member);
                const isOwnerMember = member.user_id === community.owner_id || member.role === 'owner';
                const isSelf = member.user_id === profile?.id;
                const canModerate = isCommunityOwner && !isSelf && !isOwnerMember;
                const memberName = memberProfile?.display_name || memberProfile?.username || 'Unknown';
                return (
                  <div key={member.id} className="rounded-lg border border-surface-700 bg-surface-900/40 px-3 py-2 flex items-center gap-3">
                    <img
                      src={memberProfile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(memberName)}`}
                      alt={memberName}
                      className="w-9 h-9 rounded-full object-cover border border-surface-700"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-surface-200 font-medium truncate">{memberName}</div>
                      <div className="text-xs text-surface-500 truncate">@{memberProfile?.username || 'unknown'}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-surface-700 text-surface-300">
                      {memberRoleLabel(member.role)}
                    </span>
                    {canModerate && (
                      <select
                        value={member.role}
                        onChange={(event) => {
                          void handleMemberRoleUpdate(member.user_id, event.target.value as CommunityRole);
                        }}
                        disabled={memberActionUserId === member.user_id}
                        className="nyptid-input !h-9 !w-36 text-xs"
                      >
                        <option value="admin">{memberRoleLabel('admin')}</option>
                        <option value="moderator">{memberRoleLabel('moderator')}</option>
                        <option value="member">{memberRoleLabel('member')}</option>
                      </select>
                    )}
                    {canModerate && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRemoveMember(member.user_id);
                        }}
                        disabled={memberActionUserId === member.user_id}
                        className="nyptid-btn-secondary px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                        title="Remove member"
                      >
                        <UserX size={12} />
                        Remove
                      </button>
                    )}
                    {isCommunityOwner && !isSelf && !isOwnerMember && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleTransferOwnership(member.user_id);
                        }}
                        disabled={memberActionUserId === member.user_id}
                        className="nyptid-btn-secondary px-2.5 py-1.5 text-xs"
                      >
                        Transfer Ownership
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nyptid-card p-5 border border-red-500/30">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={16} className="text-red-300" />
              <h2 className="text-lg font-bold text-red-200">Danger Zone</h2>
            </div>
            <p className="text-sm text-surface-400 mb-4">
              Permanently delete this server and all of its channels, messages, invites, and member settings.
            </p>
            <button
              type="button"
              onClick={() => {
                void handleDeleteCommunity();
              }}
              disabled={!canDeleteCommunity || deletingCommunity}
              className="nyptid-btn-secondary px-4 py-2 text-sm text-red-200 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              {deletingCommunity ? 'Deleting server...' : 'Delete Server'}
            </button>
            {!canDeleteCommunity && (
              <p className="text-xs text-surface-500 mt-2">Only the current server owner can delete this server.</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate(`/app/community/${communityId}`)}
              className="nyptid-btn-secondary"
            >
              Back to Community
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
              className="nyptid-btn-primary"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Server Settings'}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

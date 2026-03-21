import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const AVATARS = [
  'https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150',
  'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=150',
  'https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?auto=compress&cs=tinysrgb&w=150',
  'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=150',
  'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=150',
  'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=150',
];

export function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [usernameAvail, setUsernameAvail] = useState<null | boolean>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const appLogoUrl = `${import.meta.env.BASE_URL}NCore.jpg`;

  useEffect(() => {
    if (profile?.username && profile?.display_name) {
      navigate('/app');
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameAvail(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCheckingUsername(true);
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase())
        .maybeSingle();
      setUsernameAvail(!data);
      setCheckingUsername(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [username]);

  async function handleComplete() {
    if (!user) return;
    if (!username || !displayName) {
      setError('Username and display name are required.');
      return;
    }
    if (usernameAvail === false) {
      setError('Username is already taken.');
      return;
    }
    setLoading(true);
    setError('');

    const { error: err } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        username: username.toLowerCase().replace(/[^a-z0-9_]/g, ''),
        display_name: displayName,
        bio,
        avatar_url: selectedAvatar || null,
        platform_role: 'user',
        status: 'online',
      });

    if (err) {
      if (err.message.includes('unique')) {
        setError('Username already taken. Please choose another.');
      } else {
        setError(err.message);
      }
      setLoading(false);
      return;
    }

    await refreshProfile();
    navigate('/app');
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center px-6 py-12">
      <div className="absolute inset-0 bg-grid" />
      <div className="absolute inset-0 bg-hero-gradient" />

      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-nyptid-300/40 bg-surface-900">
              <img
                src={appLogoUrl}
                alt="NCore logo"
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-2xl font-black tracking-wider text-gradient">NCore</span>
          </div>
          <h1 className="text-3xl font-black text-surface-100 mb-2">Set up your profile</h1>
          <p className="text-surface-400">Let the community know who you are</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step >= s ? 'bg-nyptid-300 text-surface-950' : 'bg-surface-700 text-surface-400'}`}>
                {step > s ? <Check size={16} /> : s}
              </div>
              {s < 2 && <div className={`w-16 h-0.5 transition-colors ${step > s ? 'bg-nyptid-300' : 'bg-surface-700'}`} />}
            </div>
          ))}
        </div>

        <div className="nyptid-card p-8">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm mb-6">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-surface-100">Basic information</h2>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1.5">Display name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="nyptid-input"
                  placeholder="How you'll appear to others"
                  maxLength={32}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1.5">Username <span className="text-red-400">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className={`nyptid-input pl-7 pr-10 ${usernameAvail === false ? 'border-red-500' : usernameAvail === true ? 'border-green-500' : ''}`}
                    placeholder="your_username"
                    maxLength={20}
                    minLength={3}
                  />
                  {checkingUsername && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
                  )}
                  {!checkingUsername && usernameAvail === true && (
                    <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400" />
                  )}
                  {!checkingUsername && usernameAvail === false && (
                    <AlertCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400" />
                  )}
                </div>
                <p className="text-xs text-surface-500 mt-1">3-20 characters, lowercase letters, numbers, and underscores only</p>
                {usernameAvail === false && <p className="text-xs text-red-400 mt-1">Username is taken</p>}
                {usernameAvail === true && <p className="text-xs text-green-400 mt-1">Username is available!</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1.5">Bio <span className="text-surface-500">(optional)</span></label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  className="nyptid-input resize-none"
                  placeholder="Tell us a bit about yourself..."
                  rows={3}
                  maxLength={200}
                />
                <p className="text-xs text-surface-600 mt-1 text-right">{bio.length}/200</p>
              </div>

              <button
                onClick={() => {
                  if (!displayName || !username) { setError('Display name and username are required.'); return; }
                  if (username.length < 3) { setError('Username must be at least 3 characters.'); return; }
                  if (usernameAvail === false) { setError('Username is already taken.'); return; }
                  setError('');
                  setStep(2);
                }}
                className="nyptid-btn-primary w-full py-3"
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-surface-100">Choose an avatar</h2>
              <p className="text-surface-400 text-sm">Pick a default avatar or skip to use your initials</p>

              <div className="grid grid-cols-3 gap-3">
                {AVATARS.map(avatar => (
                  <button
                    key={avatar}
                    onClick={() => setSelectedAvatar(selectedAvatar === avatar ? '' : avatar)}
                    className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all ${selectedAvatar === avatar ? 'border-nyptid-300 shadow-glow' : 'border-surface-700 hover:border-surface-500'}`}
                  >
                    <img src={avatar} alt="Avatar option" className="w-full h-full object-cover" />
                    {selectedAvatar === avatar && (
                      <div className="absolute inset-0 bg-nyptid-300/20 flex items-center justify-center">
                        <div className="w-8 h-8 bg-nyptid-300 rounded-full flex items-center justify-center">
                          <Check size={16} className="text-surface-950" />
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 p-4 bg-surface-900 rounded-xl border border-surface-700">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-nyptid-700 to-nyptid-900 flex items-center justify-center flex-shrink-0">
                  {selectedAvatar ? (
                    <img src={selectedAvatar} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-nyptid-200">
                      {displayName.charAt(0).toUpperCase() || <User size={20} />}
                    </span>
                  )}
                </div>
                <div>
                  <div className="font-semibold text-surface-100">{displayName}</div>
                  <div className="text-sm text-surface-400">@{username}</div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="nyptid-btn-secondary flex-1 py-3">
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  className="nyptid-btn-primary flex-1 py-3"
                  disabled={loading}
                >
                  {loading ? 'Saving...' : 'Complete Setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

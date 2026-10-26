import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { Input } from '@/components/ui/Input';
import {
  Award,
  ShieldCheck,
  Download,
  ExternalLink,
  Calendar,
  AlertCircle,
  EyeOff,
  Copy,
  HeartHandshake,
  Users,
  CheckCircle2,
  Globe,
  Ticket,
  MapPin,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/api-client';
import { QRDisplay } from '@/components/ui/QRDisplay';

export interface UserCertificate {
  id: string;
  verification_code: string;
  issued_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  event_id: string;
  event_title: string;
  event_date: string;
}

export interface StudentAchievement {
  id: string;
  type: 'ATTENDANCE' | 'VOLUNTEER' | 'CERTIFICATE' | 'TEAM_PARTICIPATION';
  sourceEventId: string;
  sourceRefId: string;
  eventTitle: string;
  eventDate: string;
  verificationStatus: 'VERIFIED' | 'PENDING' | 'REVOKED';
  visibility: 'private' | 'public';
  createdAt: string;
}

export interface PassportSettings {
  userId: string;
  isPublic: boolean;
  slug: string;
  showAttendance: boolean;
  showVolunteer: boolean;
  showCertificates: boolean;
  updatedAt: string;
}

const DEFAULT_PROTOTYPE_ACHIEVEMENTS: StudentAchievement[] = [
  {
    id: 'ach-1',
    type: 'CERTIFICATE',
    sourceEventId: 'evt-ai-summit',
    sourceRefId: 'cert-7h9k2m4n',
    eventTitle: 'Smart Campus AI & Robotics Symposium 2026',
    eventDate: '2026-11-20T10:00:00Z',
    verificationStatus: 'VERIFIED',
    visibility: 'public',
    createdAt: '2026-11-20T16:00:00Z',
  },
  {
    id: 'ach-2',
    type: 'ATTENDANCE',
    sourceEventId: 'evt-hackathon',
    sourceRefId: 'scan-882190',
    eventTitle: 'Inter-College Autonomous Hackathon 2026',
    eventDate: '2026-10-15T09:00:00Z',
    verificationStatus: 'VERIFIED',
    visibility: 'public',
    createdAt: '2026-10-15T09:12:00Z',
  },
  {
    id: 'ach-3',
    type: 'VOLUNTEER',
    sourceEventId: 'evt-summit-vol',
    sourceRefId: 'shift-vol-441',
    eventTitle: 'National Tech Summit 2026',
    eventDate: '2026-09-10T08:00:00Z',
    verificationStatus: 'VERIFIED',
    visibility: 'public',
    createdAt: '2026-09-10T17:30:00Z',
  },
];

export const PassportPage: React.FC<{
  onNavigateToVerify?: (code: string) => void;
  onNavigateToPublicPassport?: (slug: string) => void;
}> = ({ onNavigateToVerify, onNavigateToPublicPassport }) => {
  const navigate = useNavigate();
  const navigateToPublicPassport = onNavigateToPublicPassport || ((slug: string) => navigate(`/p/${slug}`));
  const navigateToVerify = onNavigateToVerify || ((code: string) => navigate(`/verify?code=${code}`));
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'timeline' | 'passes' | 'certificates' | 'settings'>('timeline');
  const [achievements, setAchievements] = useState<StudentAchievement[]>(DEFAULT_PROTOTYPE_ACHIEVEMENTS);
  const [activeTickets, setActiveTickets] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<UserCertificate[]>([
    {
      id: 'cert-7h9k2m4n',
      verification_code: '7H9K-2M4N-8PQR',
      issued_at: '2026-11-20T16:00:00Z',
      revoked_at: null,
      revoke_reason: null,
      event_id: 'evt-ai-summit',
      event_title: 'Smart Campus AI & Robotics Symposium 2026',
      event_date: '2026-11-20T10:00:00Z',
    },
  ]);
  const [settings, setSettings] = useState<PassportSettings>(() => {
    const isPub = typeof localStorage !== 'undefined' ? localStorage.getItem('eventora_passport_public') === 'true' : false;
    const slug = typeof localStorage !== 'undefined' ? localStorage.getItem('eventora_passport_slug') || 'aarav-patel' : 'aarav-patel';
    return {
      userId: 'u_student',
      isPublic: isPub,
      slug,
      showAttendance: true,
      showVolunteer: true,
      showCertificates: true,
      updatedAt: new Date().toISOString(),
    };
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [selectedCert, setSelectedCert] = useState<any | null>(null);

  // Load Passport and Achievements from API
  const loadPassportData = useCallback(async () => {
    setIsLoading(true);

    try {
      const [passData, certData, ticketsData] = await Promise.all([
        apiClient<any>('/api/v1/me/passport'),
        apiClient<any>('/api/v1/me/certificates'),
        apiClient<any>('/api/v1/me/tickets'),
      ]);

      if (passData) {
        if (passData.settings) setSettings(passData.settings);
        if (passData.achievements && passData.achievements.length > 0) setAchievements(passData.achievements);
      }

      if (certData && Array.isArray(certData.certificates) && certData.certificates.length > 0) {
        setCertificates(certData.certificates);
      }

      if (ticketsData && Array.isArray(ticketsData.tickets)) {
        setActiveTickets(ticketsData.tickets);
      }
    } catch {
      // Prototype fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPassportData();
  }, [loadPassportData]);

  // Update Settings
  const handleSaveSettings = async (partial: Partial<PassportSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    if (typeof localStorage !== 'undefined') {
      if (partial.isPublic !== undefined) {
        localStorage.setItem('eventora_passport_public', partial.isPublic ? 'true' : 'false');
      }
      if (partial.slug !== undefined) {
        localStorage.setItem('eventora_passport_slug', partial.slug);
      }
    }
    setIsSavingSettings(true);

    try {
      const data = await apiClient<any>('/api/v1/me/passport/visibility', {
        method: 'PATCH',
        body: JSON.stringify(partial),
      });

      if (data?.settings) setSettings(data.settings);
      toast({
        type: 'success',
        title: 'Passport Settings Saved',
        message: partial.isPublic !== undefined
          ? partial.isPublic
            ? 'Public passport URL is now active.'
            : 'Passport is now completely private.'
          : 'Visibility preferences updated.',
      });
    } catch {
      toast({
        type: 'info',
        title: 'Settings Updated (Local)',
        message: 'Passport preferences adjusted.',
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // One-tap "Hide Everything"
  const handleHideEverything = async () => {
    await handleSaveSettings({
      isPublic: false,
    });
  };

  // Copy Public Link
  const handleCopyLink = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://eventora.campus.edu';
    const publicUrl = `${origin}/p/${settings.slug}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(publicUrl);
      toast({
        type: 'success',
        title: 'Link Copied',
        message: publicUrl,
      });
    }
  };

  const handleDownload = async (certId: string) => {
    try {
      const data = await apiClient<any>(`/api/v1/certificates/${certId}/download`);
      if (data?.certificate) {
        setSelectedCert(data.certificate);
        return;
      }
    } catch {
      // fallback
    }

    const found = certificates.find((c) => c.id === certId);
    setSelectedCert({
      id: certId,
      eventTitle: found?.event_title || 'Smart Campus AI & Robotics Symposium 2026',
      attendeeName: 'Aarav Patel',
      verificationCode: found?.verification_code || '7H9K-2M4N-8PQR',
      issuedAt: found?.issued_at || new Date().toISOString(),
      verifyUrl: `https://eventora.campus.edu/verify/${found?.verification_code || '7H9K-2M4N-8PQR'}`,
      hashHex: '8f4325a76e9c1d0f8a92bc654e321a987b654321cba9876543210fedcba98765',
    });
  };

  const getAchievementIcon = (type: StudentAchievement['type']) => {
    switch (type) {
      case 'CERTIFICATE':
        return <Award className="w-4 h-4 text-brand" />;
      case 'VOLUNTEER':
        return <HeartHandshake className="w-4 h-4 text-emerald-500" />;
      case 'TEAM_PARTICIPATION':
        return <Users className="w-4 h-4 text-amber-500" />;
      case 'ATTENDANCE':
      default:
        return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
    }
  };

  const verifiedAchievementsCount = achievements.filter((a) => a.verificationStatus === 'VERIFIED').length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header & Policy */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text flex items-center gap-2">
            <Award className="w-6 h-6 text-brand" />
            <span>Student Event Passport & Credentials</span>
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            FR-PASS Cryptographically Anchored Milestone Timeline • Cross-College Proof of Activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="brand" size="sm" className="font-mono">
            {verifiedAchievementsCount} Verified Milestones
          </Badge>
          <Badge variant={settings.isPublic ? 'success' : 'neutral'} size="sm">
            {settings.isPublic ? 'Public Visible' : 'Private'}
          </Badge>
        </div>
      </div>

      {/* Public Status & Share Banner */}
      <Card className="p-4 bg-surface border-l-4 border-l-brand space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {settings.isPublic ? (
                <Globe className="w-4 h-4 text-success" />
              ) : (
                <EyeOff className="w-4 h-4 text-text-muted" />
              )}
              <span className="text-xs font-bold text-text uppercase tracking-wider">
                Public Passport Status: {settings.isPublic ? 'ONLINE & PUBLIC' : 'HIDDEN / PRIVATE'}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {settings.isPublic
                ? `Shareable verified URL: /p/${settings.slug} (Cache-Control: no-store zero CDN lag)`
                : 'Your passport is completely invisible to outsiders. Public queries return 404.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {settings.isPublic ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="text-xs flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToPublicPassport(settings.slug)}
                  className="text-xs flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>View Public Page</span>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleHideEverything}
                  disabled={isSavingSettings}
                  className="text-xs flex items-center gap-1.5"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Hide Everything</span>
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSaveSettings({ isPublic: true })}
                disabled={isSavingSettings}
                className="text-xs flex items-center gap-1.5"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Make Public</span>
              </Button>
            )}
          </div>
        </div>

        {/* Tab Controls */}
        <div className="pt-2 border-t border-border flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`px-3 py-1.5 font-semibold rounded-md transition-colors ${
              activeTab === 'timeline'
                ? 'bg-brand text-white shadow-xs'
                : 'text-text-muted hover:text-text bg-surface-2'
            }`}
          >
            Milestone Timeline ({achievements.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('passes')}
            className={`px-3 py-1.5 font-semibold rounded-md transition-colors ${
              activeTab === 'passes'
                ? 'bg-brand text-white shadow-xs'
                : 'text-text-muted hover:text-text bg-surface-2'
            }`}
          >
            Event Passes ({activeTickets.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('certificates')}
            className={`px-3 py-1.5 font-semibold rounded-md transition-colors ${
              activeTab === 'certificates'
                ? 'bg-brand text-white shadow-xs'
                : 'text-text-muted hover:text-text bg-surface-2'
            }`}
          >
            Digital Certificates ({certificates.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 font-semibold rounded-md transition-colors ${
              activeTab === 'settings'
                ? 'bg-brand text-white shadow-xs'
                : 'text-text-muted hover:text-text bg-surface-2'
            }`}
          >
            Privacy & Visibility Controls
          </button>
        </div>
      </Card>

      {/* Tab: Active Event Passes */}
      {activeTab === 'passes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-text flex items-center gap-2">
              <Ticket className="w-4 h-4 text-brand" />
              <span>Registered Event Passes & Tickets</span>
            </h2>
            <Badge variant="brand" size="sm">
              Live Verified QR Passes
            </Badge>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-xs">
              Loading event passes...
            </div>
          ) : activeTickets.length === 0 ? (
            <Card className="p-8 text-center text-text-muted space-y-2 border border-dashed border-border">
              <Ticket className="w-10 h-10 mx-auto text-text-muted/40" />
              <p className="text-sm font-semibold text-text">No Active Event Passes</p>
              <p className="text-xs max-w-sm mx-auto">
                Register for upcoming events in the Discovery feed to receive high-contrast digital QR passes.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTickets.map((t) => (
                <Card key={t.id} className="p-4 space-y-3 hover:border-brand/50 transition-colors text-xs flex flex-col justify-between border border-border">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-text leading-snug">{t.event_title || 'Campus Event'}</h3>
                      <Badge variant={t.status === 'VALID' ? 'success' : t.status === 'CHECKED_IN' ? 'brand' : 'neutral'} size="sm">
                        {t.status === 'VALID' ? 'CONFIRMED' : t.status === 'CHECKED_IN' ? 'ATTENDED' : t.status}
                      </Badge>
                    </div>

                    <div className="space-y-1 text-text-muted text-[11px]">
                      {t.event_starts_at && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-brand" />
                          <span>{new Date(t.event_starts_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                      )}
                      {t.venue_name && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-brand" />
                          <span>{t.venue_name}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Ticket className="w-3.5 h-3.5 text-brand" />
                        <span>Pass Code: <strong className="font-mono text-text">{t.ticket_code}</strong></span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-surface-2 rounded-lg flex items-center justify-center border border-border">
                      <QRDisplay
                        ticketId={t.ticket_code}
                        qrPayloadPreview={`https://eventora-jet.vercel.app/verify/${t.ticket_code}`}
                        status={t.status === 'VALID' ? 'VALID' : 'CANCELLED'}
                        eventName={t.event_title || 'Campus Event'}
                        attendeeName="Student Attendee"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Timeline View */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-text flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand" />
              <span>Verified Milestone Feed</span>
            </h2>
            <Badge variant="neutral" size="sm">
              Server-Verified Records Only (Anti-Tamper)
            </Badge>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-xs">
              Loading passport achievements...
            </div>
          ) : achievements.length === 0 ? (
            <Card className="p-8 text-center text-text-muted space-y-2">
              <ShieldCheck className="w-10 h-10 mx-auto text-text-muted/40" />
              <p className="text-sm font-semibold text-text">No Milestones Recorded Yet</p>
              <p className="text-xs max-w-sm mx-auto">
                Check in to registered events or complete verified volunteer shifts to automatically earn immutable passport entries.
              </p>
            </Card>
          ) : (
            <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
              {achievements.map((item) => (
                <div key={item.id} className="relative group">
                  <span className="absolute -left-6 top-3 w-3 h-3 rounded-full bg-brand border-2 border-surface" />

                  <Card className="p-4 hover:border-brand/40 transition-colors space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getAchievementIcon(item.type)}
                        <span className="font-bold uppercase tracking-wider text-[11px] text-text">
                          [{item.type}]
                        </span>
                        <Badge
                          variant={
                            item.verificationStatus === 'VERIFIED'
                              ? 'success'
                              : item.verificationStatus === 'PENDING'
                              ? 'warning'
                              : 'error'
                          }
                          size="sm"
                        >
                          {item.verificationStatus === 'PENDING'
                            ? 'Pending verification'
                            : item.verificationStatus}
                        </Badge>
                      </div>

                      <span className="text-[11px] text-text-muted font-mono">
                        {new Date(item.eventDate || item.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-text">{item.eventTitle}</h3>

                    <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-text-muted">
                      <span>Ref: {item.sourceRefId.substring(0, 8)}...</span>
                      <span>Visibility: <strong className="text-text capitalize">{item.visibility}</strong></span>
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Issued Certificates */}
      {activeTab === 'certificates' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {certificates.map((cert) => {
              const isRevoked = Boolean(cert.revoked_at);
              return (
                <Card key={cert.id} className="p-4 space-y-3 hover:border-brand/50 transition-colors text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-text leading-snug">{cert.event_title}</h3>
                    <Badge variant={isRevoked ? 'error' : 'success'} size="sm">
                      {isRevoked ? 'Revoked' : 'Authentic'}
                    </Badge>
                  </div>

                  <div className="p-2 bg-surface-2 rounded border border-border">
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider block">
                      Crockford Verification Code
                    </span>
                    <p className="font-mono text-sm font-bold text-brand tracking-widest mt-0.5">
                      {cert.verification_code}
                    </p>
                  </div>

                  {isRevoked && (
                    <div className="p-2 bg-error/10 border border-error/30 rounded text-[11px] text-error flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Revoked: {cert.revoke_reason || 'Administrative Action'}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(cert.id)} className="text-xs">
                      <Download className="w-3.5 h-3.5 mr-1" />
                      Download
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigateToVerify(cert.verification_code)}
                      className="text-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Verify
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Privacy & Visibility Settings (FR-PASS) */}
      {activeTab === 'settings' && (
        <Card className="p-5 space-y-4">
          <div className="pb-3 border-b border-border">
            <h2 className="text-base font-bold text-text flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand" />
              <span>Passport Visibility & Sharing Controls</span>
            </h2>
            <p className="text-xs text-text-muted mt-1">
              Control what participating recruiters, cross-college organizers, and external viewers can see.
            </p>
          </div>

          <div className="space-y-4">
            {/* Master Public Toggle */}
            <div className="p-3 bg-surface-2 rounded-lg border border-border flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-text">Public Passport Active</p>
                <p className="text-[11px] text-text-muted">
                  When enabled, your portfolio is viewable at /p/{settings.slug}
                </p>
              </div>
              <Switch
                checked={settings.isPublic}
                onChange={(checked) => handleSaveSettings({ isPublic: checked })}
                aria-label="Toggle public passport visibility"
              />
            </div>

            {/* Slug Editor */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text">Public URL Handle (Slug)</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted font-mono bg-surface-2 px-2.5 py-2 rounded border border-border">
                  https://eventora.campus.edu/p/
                </span>
                <Input
                  value={settings.slug}
                  onChange={(e) => setSettings({ ...settings, slug: e.target.value })}
                  className="text-xs font-mono"
                />
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => handleSaveSettings({ slug: settings.slug })}
                  disabled={isSavingSettings}
                  className="text-xs"
                >
                  Save
                </Button>
              </div>
            </div>

            {/* Granular Milestone Filters */}
            <div className="pt-3 border-t border-border space-y-3">
              <h3 className="text-xs font-bold text-text">Included Public Sections</h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-text">Attendance</p>
                    <p className="text-[10px] text-text-muted">Event admittance passes</p>
                  </div>
                  <Switch
                    checked={settings.showAttendance}
                    onChange={(checked) => handleSaveSettings({ showAttendance: checked })}
                    aria-label="Toggle attendance section in public passport"
                  />
                </Card>

                <Card className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-text">Volunteer Hours</p>
                    <p className="text-[10px] text-text-muted">Verified community service</p>
                  </div>
                  <Switch
                    checked={settings.showVolunteer}
                    onChange={(checked) => handleSaveSettings({ showVolunteer: checked })}
                    aria-label="Toggle volunteer section in public passport"
                  />
                </Card>

                <Card className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-text">Certificates</p>
                    <p className="text-[10px] text-text-muted">Crockford codes & verify</p>
                  </div>
                  <Switch
                    checked={settings.showCertificates}
                    onChange={(checked) => handleSaveSettings({ showCertificates: checked })}
                    aria-label="Toggle certificates section in public passport"
                  />
                </Card>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Certificate Modal */}
      {selectedCert && (
        <Modal
          isOpen={!!selectedCert}
          onClose={() => setSelectedCert(null)}
          title="Digital Certificate of Attendance"
        >
          <div className="space-y-4 py-2 text-center text-xs">
            <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto border-2 border-brand">
              <Award className="w-7 h-7" />
            </div>

            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-widest font-bold">
                Smart Campus Verified Credential
              </span>
              <h3 className="text-base font-bold text-text mt-1">{selectedCert.eventTitle}</h3>
              <p className="text-xs text-text-muted mt-0.5">Awarded to: <strong className="text-text">{selectedCert.attendeeName}</strong></p>
            </div>

            <div className="p-3 bg-surface-2 rounded-lg border border-border text-left space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-text-muted">Verification Code:</span>
                <span className="font-bold text-brand">{selectedCert.verificationCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Issued:</span>
                <span>{new Date(selectedCert.issuedAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={() => setSelectedCert(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

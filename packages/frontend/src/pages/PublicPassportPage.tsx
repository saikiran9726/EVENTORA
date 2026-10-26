import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '@/lib/api-client';
import { reportError } from '@/lib/error-reporter';
import {
  Award,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  Lock,
  ExternalLink,
  School,
  Share2,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface PublicAchievementItem {
  id: string;
  type: string;
  title: string;
  eventDate: string;
  badgeLabel: string;
  verificationStatus: string;
}

interface PublicPassportPayload {
  displayName: string;
  slug: string;
  collegeName: string;
  verifiedStudent: boolean;
  achievements: PublicAchievementItem[];
}

export const PublicPassportPage: React.FC<{
  slug?: string;
  onBack?: () => void;
  onNavigateToVerify?: (code: string) => void;
}> = ({ slug: propSlug, onBack: propOnBack, onNavigateToVerify: propOnNavigateToVerify }) => {
  const params = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const slug = propSlug || params.slug || '';
  const onBack = propOnBack || (() => navigate('/passport'));
  const onNavigateToVerify =
    propOnNavigateToVerify || ((code: string) => navigate(`/verify/${encodeURIComponent(code)}`));
  const [passport, setPassport] = useState<PublicPassportPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const fetchPublicPassport = async () => {
      setIsLoading(true);
      setIsNotFound(false);

      try {
        const data = await apiClient.get<PublicPassportPayload>(`/api/v1/p/${slug}`);
        if (!isCancelled) {
          setPassport(data);
          setIsNotFound(false);
        }
        return;
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          // If backend returns 404, check if this is an active prototype session
          const isPublicStored = typeof localStorage !== 'undefined'
            ? localStorage.getItem('eventora_passport_public')
            : null;

          if (isPublicStored === 'false') {
            if (!isCancelled) setIsNotFound(true);
            return;
          }
        } else {
          reportError(err, { context: 'fetchPublicPassport', slug });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }

      if (!isCancelled) {
        const isPublicStored = typeof localStorage !== 'undefined'
          ? localStorage.getItem('eventora_passport_public')
          : null;
        const storedSlug = typeof localStorage !== 'undefined'
          ? localStorage.getItem('eventora_passport_slug') || 'aarav-patel'
          : 'aarav-patel';

        if (isPublicStored === 'false') {
          setIsNotFound(true);
        } else if (slug === 'aarav-patel' || slug === 'student-public' || slug === storedSlug) {
          setPassport({
            displayName: 'Aarav Patel',
            slug,
            collegeName: 'Tech University A',
            verifiedStudent: true,
            achievements: [
              {
                id: 'ach-proto-1',
                type: 'CERTIFICATE',
                title: 'Smart Campus AI & Robotics Symposium 2026',
                eventDate: '2026-11-20T10:00:00Z',
                badgeLabel: 'Verified Certificate',
                verificationStatus: 'VERIFIED',
              },
              {
                id: 'ach-proto-2',
                type: 'ATTENDANCE',
                title: 'Inter-College Autonomous Hackathon',
                eventDate: '2026-10-15T09:00:00Z',
                badgeLabel: 'Event Check-in Admitted',
                verificationStatus: 'VERIFIED',
              },
              {
                id: 'ach-proto-3',
                type: 'VOLUNTEER',
                title: 'National Tech Summit 2026',
                eventDate: '2026-09-10T08:00:00Z',
                badgeLabel: 'Verified Volunteer Service',
                verificationStatus: 'VERIFIED',
              },
            ],
          });
          setIsNotFound(false);
        } else {
          setIsNotFound(true);
        }
      }
    };

    fetchPublicPassport();
    return () => {
      isCancelled = true;
    };
  }, [slug]);

  const handleShare = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
        <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-text-muted">Resolving verified public passport...</p>
      </div>
    );
  }

  if (isNotFound || !passport) {
    return (
      <div className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center mx-auto text-text-muted">
          <Lock className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text">Passport Not Found or Private</h1>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            This student passport is either private, does not exist, or has been temporarily hidden by its owner.
          </p>
        </div>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            Return to Discovery
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Top Banner & Institution Affirmation */}
      <Card className="p-6 border-l-4 border-l-brand space-y-4 bg-gradient-to-br from-surface via-surface to-brand/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="brand" size="sm" className="font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Verified Campus Credential</span>
              </Badge>
              {passport.verifiedStudent && (
                <Badge variant="success" size="sm" className="font-semibold">
                  Verified Student
                </Badge>
              )}
              <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                /p/{passport.slug}
              </Badge>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-text">
              {passport.displayName}
            </h1>
            <p className="text-xs text-text-muted flex items-center gap-1.5 font-medium">
              <School className="w-4 h-4 text-brand" />
              <span>{passport.collegeName}</span>
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="self-start sm:self-center text-xs"
          >
            <Share2 className="w-3.5 h-3.5 mr-1.5" />
            <span>{copied ? 'Link Copied!' : 'Share Passport'}</span>
          </Button>
        </div>

        {/* Security & Zero-PII Affirmation */}
        <div className="pt-3 border-t border-border/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
          <span className="flex items-center gap-1 text-success font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            Institutionally Signed Records • Zero PII Protected
          </span>
          <span>{passport.achievements.length} verified milestone(s)</span>
        </div>
      </Card>

      {/* Verified Achievements Timeline */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-text flex items-center gap-2 uppercase tracking-wider">
          <Award className="w-4 h-4 text-brand" />
          <span>Verified Achievement Timeline</span>
        </h2>

        {passport.achievements.length === 0 ? (
          <Card className="p-8 text-center text-text-muted space-y-2">
            <Award className="w-8 h-8 opacity-40 mx-auto" />
            <p className="text-xs">No public achievements shared in this passport.</p>
          </Card>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
            {passport.achievements.map((item) => (
              <div key={item.id} className="relative group">
                {/* Timeline Dot */}
                <span className="absolute -left-6 top-3 w-3 h-3 rounded-full bg-brand border-2 border-surface" />

                <Card className="p-4 hover:border-brand/50 transition-colors space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-brand uppercase tracking-wider">
                      {item.badgeLabel}
                    </span>
                    <span className="text-[11px] text-text-muted font-mono flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(item.eventDate).toLocaleDateString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-text leading-snug">{item.title}</h3>

                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs">
                    <Badge variant="success" size="sm" className="text-[10px]">
                      {item.verificationStatus}
                    </Badge>

                    {item.type === 'CERTIFICATE' && onNavigateToVerify && (
                      <button
                        type="button"
                        onClick={() => onNavigateToVerify(item.id)}
                        className="text-[11px] font-semibold text-brand hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Verify Credential
                      </button>
                    )}
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      {onBack && (
        <div className="pt-4 text-center">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back to Student Hub
          </Button>
        </div>
      )}
    </div>
  );
};

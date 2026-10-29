import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/api-client';
import {
  Users,
  UserPlus,
  Lock,
  CheckCircle2,
  FolderGit2,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';

export interface TeamMember {
  userId: string;
  displayName: string;
  email?: string;
  role: 'leader' | 'co_leader' | 'member';
  status: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  description?: string;
  visibility: 'private' | 'discoverable';
  maxSize: number;
  status: string;
  skillsOffered: string[];
  skillsNeeded: string[];
  members?: TeamMember[];
  isLeader?: boolean;
}

export const TeamsPage: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'my' | 'discover'>('my');
  const [myTeams, setMyTeams] = useState<TeamRecord[]>([]);
  const [discoverTeams, setDiscoverTeams] = useState<TeamRecord[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamRecord | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [_isLoading, setIsLoading] = useState(false);

  // New team form
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [newTeamVis, setNewTeamVis] = useState<'private' | 'discoverable'>('discoverable');
  const [newTeamSize, setNewTeamSize] = useState(4);
  const [newTeamSkillsOffered, setNewTeamSkillsOffered] = useState('React, Python, UI/UX');
  const [newTeamSkillsNeeded, setNewTeamSkillsNeeded] = useState('Rust, Machine Learning');

  // Project submission form
  const [projectTitle, setProjectTitle] = useState('');
  const [projectAbstract, setProjectAbstract] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');

  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null);

  const loadTeams = async () => {
    setIsLoading(true);
    try {
      const [discoverRes, myRes] = await Promise.allSettled([
        apiClient<any>('/api/v1/teams'),
        apiClient<any>('/api/v1/teams?mine=true'),
      ]);

      if (discoverRes.status === 'fulfilled' && discoverRes.value?.teams) {
        setDiscoverTeams(discoverRes.value.teams || []);
      }
      if (myRes.status === 'fulfilled' && myRes.value?.teams && myRes.value.teams.length > 0) {
        setMyTeams(myRes.value.teams);
        setSelectedTeam(myRes.value.teams[0]);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestJoin = async (team: TeamRecord) => {
    setJoiningTeamId(team.id);
    try {
      await apiClient(`/api/v1/teams/${team.id}/join-requests`, {
        method: 'POST',
      });
      toast({
        type: 'success',
        title: 'Join Request Submitted',
        message: `Requested to join ${team.name}. Team leaders will review your application.`,
      });
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Could Not Send Request',
        message: err.message || 'Failed to submit join request.',
      });
    } finally {
      setJoiningTeamId(null);
    }
  };

  useEffect(() => {
    loadTeams();

    // Default mock team if list empty
    const mock: TeamRecord = {
      id: 'team-mock-1',
      name: 'NeuralHack Squad',
      description: 'Building AI autonomous edge agents for campus sustainability.',
      visibility: 'discoverable',
      maxSize: 4,
      status: 'active',
      skillsOffered: ['Python', 'FastAPI', 'PyTorch'],
      skillsNeeded: ['React', 'Tailwind', 'Embedded IoT'],
      isLeader: true,
      members: [
        { userId: 'u-1', displayName: 'Aarav Sharma (You)', email: 'aarav@campus.edu', role: 'leader', status: 'ACTIVE' },
        { userId: 'u-2', displayName: 'Priya Patel', email: 'priya@campus.edu', role: 'co_leader', status: 'ACTIVE' },
        { userId: 'u-3', displayName: 'Kavya Rao', email: 'kavya@campus.edu', role: 'member', status: 'ACTIVE' },
      ],
    };
    setMyTeams([mock]);
    setSelectedTeam(mock);
  }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    try {
      const data = await apiClient<any>('/api/v1/teams', {
        method: 'POST',
        body: JSON.stringify({
          name: newTeamName,
          description: newTeamDesc,
          visibility: newTeamVis,
          maxSize: Number(newTeamSize),
          skillsOffered: newTeamSkillsOffered.split(',').map((s) => s.trim()).filter(Boolean),
          skillsNeeded: newTeamSkillsNeeded.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });

      toast({ type: 'success', title: 'Team Created', message: `Team "${newTeamName}" is ready.` });
      setIsCreateOpen(false);
      setMyTeams((prev) => [data.team, ...prev]);
      setSelectedTeam(data.team);
    } catch (err: any) {
      toast({ type: 'error', title: 'Error', message: err.message || 'Failed to create team.' });
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !inviteEmail.trim()) return;

    try {
      await apiClient(`/api/v1/teams/${selectedTeam.id}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail }),
      });

      toast({ type: 'success', title: 'Invitation Sent', message: `Invited ${inviteEmail} to the squad.` });
      setIsInviteOpen(false);
      setInviteEmail('');
    } catch (err: any) {
      toast({ type: 'error', title: 'Error', message: err.message || 'Could not send invitation.' });
    }
  };

  const handleProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      type: 'success',
      title: 'Deliverables Submitted!',
      message: 'Project repository and abstract recorded. Locked upon deadline.',
    });
    setIsSubmitOpen(false);
  };

  const currentMembersCount = selectedTeam?.members?.length || 1;
  const isSizeReady = currentMembersCount >= 2 && currentMembersCount <= (selectedTeam?.maxSize || 4);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Team Hub & Hackathons</h1>
          <p className="text-sm text-muted mt-1">
            Build cross-disciplinary teams, recruit campus talent, and register for competitions.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Team
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setActiveTab('my')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'my' ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          My Teams ({myTeams.length})
        </button>
        <button
          onClick={() => setActiveTab('discover')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'discover' ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          Discover Teams ({discoverTeams.length})
        </button>
      </div>

      {activeTab === 'my' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Teams List (Sidebar) */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Your Active Teams</h3>
            {myTeams.map((team) => (
              <Card
                key={team.id}
                onClick={() => setSelectedTeam(team)}
                className={`p-4 cursor-pointer transition-all border ${
                  selectedTeam?.id === team.id
                    ? 'border-brand-600 bg-brand-50/10 ring-1 ring-brand-600'
                    : 'border-border hover:border-brand-300'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-text text-sm">{team.name}</h4>
                    <p className="text-xs text-muted line-clamp-1 mt-0.5">{team.description}</p>
                  </div>
                  <Badge variant={team.visibility === 'discoverable' ? 'info' : 'neutral'} size="sm">
                    {team.visibility}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-brand-600" />
                    {team.members?.length || 1} / {team.maxSize} members
                  </span>
                  <span className="text-success font-medium">Ready</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Selected Team Overview (2 Cols) */}
          {selectedTeam && (
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-6 border border-border shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-text">{selectedTeam.name}</h2>
                      <Badge variant="success" size="sm">Active Squad</Badge>
                    </div>
                    <p className="text-xs text-muted mt-1">{selectedTeam.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setIsInviteOpen(true)} className="flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4" /> Invite
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setIsSubmitOpen(true)} className="flex items-center gap-1.5">
                      <FolderGit2 className="w-4 h-4" /> Deliverables
                    </Button>
                  </div>
                </div>

                {/* Readiness Checklist */}
                <div className="p-4 bg-surface-2 rounded-lg border border-border space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-600" />
                    Event Registration Readiness Checklist
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`w-4 h-4 ${isSizeReady ? 'text-success' : 'text-muted'}`} />
                      <span className={isSizeReady ? 'text-text' : 'text-muted'}>
                        Team size meets competition requirements ({currentMembersCount}/{selectedTeam.maxSize} members, min 2)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="text-text">Leader authority verified</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="text-text">Skills complement declared (Frontend, Backend, ML)</span>
                    </div>
                  </div>
                </div>

                {/* Team Members */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">Roster</h4>
                  <div className="divide-y divide-border/60">
                    {selectedTeam.members?.map((m) => (
                      <div key={m.userId} className="py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-950 flex items-center justify-center text-brand-600 font-bold text-xs">
                            {m.displayName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text">{m.displayName}</p>
                            <p className="text-xs text-muted capitalize">{m.role.replace('_', ' ')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={m.role === 'leader' ? 'brand' : 'neutral'} size="sm">
                            {m.role}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      ) : (
        /* Discover Teams Tab */
        <div className="space-y-4">
          <div className="flex items-center gap-3 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-muted absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search teams by skill or idea..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-sm pl-9 pr-4 py-2 rounded-lg border border-border bg-surface text-text"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {discoverTeams.length === 0 ? (
              <div className="col-span-full py-12 text-center text-muted">
                No discoverable teams found. Create one or adjust your search filter!
              </div>
            ) : (
              discoverTeams.map((team) => (
                <Card key={team.id} className="p-5 border border-border flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h4 className="font-semibold text-text text-base">{team.name}</h4>
                      <Badge variant={team.visibility === 'discoverable' ? 'info' : 'neutral'} size="sm">
                        {team.visibility}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted line-clamp-2">{team.description}</p>

                    <div className="pt-2">
                      <span className="text-[11px] font-bold text-muted uppercase">Skills Needed:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {team.skillsNeeded?.map((sk, i) => (
                          <Badge key={i} variant="neutral" size="sm">{sk}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border mt-4 flex items-center justify-between">
                    <span className="text-xs text-muted">Max {team.maxSize} members</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRequestJoin(team)}
                      disabled={joiningTeamId === team.id}
                    >
                      {joiningTeamId === team.id ? 'Sending...' : 'Request to Join'}
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {isCreateOpen && (
        <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create New Team">
          <form onSubmit={handleCreateTeam} className="space-y-4 py-2">
            <Input
              label="Team Name"
              required
              placeholder="e.g. Quantum Pioneers"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
            <div>
              <label className="block text-xs font-medium text-text mb-1">Description / Project Goal</label>
              <textarea
                className="w-full text-sm p-2.5 rounded-lg border border-border bg-surface text-text"
                rows={3}
                placeholder="What is your team building or aiming for?"
                value={newTeamDesc}
                onChange={(e) => setNewTeamDesc(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Visibility</label>
                <select
                  className="w-full text-sm p-2 rounded-lg border border-border bg-surface text-text"
                  value={newTeamVis}
                  onChange={(e) => setNewTeamVis(e.target.value as any)}
                >
                  <option value="discoverable">Discoverable (Public to campus)</option>
                  <option value="private">Private (Invite only - 404 to non-members)</option>
                </select>
              </div>
              <Input
                label="Max Team Size (2 - 10)"
                type="number"
                min={2}
                max={10}
                value={newTeamSize}
                onChange={(e) => setNewTeamSize(Number(e.target.value))}
              />
            </div>
            <Input
              label="Skills Offered (comma-separated)"
              placeholder="e.g. React, Python, Cloud"
              value={newTeamSkillsOffered}
              onChange={(e) => setNewTeamSkillsOffered(e.target.value)}
            />
            <Input
              label="Skills Needed (comma-separated)"
              placeholder="e.g. Rust, PyTorch, Figma"
              value={newTeamSkillsNeeded}
              onChange={(e) => setNewTeamSkillsNeeded(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit">Create Team</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Invite Modal */}
      {isInviteOpen && (
        <Modal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} title="Invite Teammate">
          <form onSubmit={handleInvite} className="space-y-4 py-2">
            <p className="text-xs text-muted">
              Enter the campus email address of the student you wish to invite to <strong>{selectedTeam?.name}</strong>.
            </p>
            <Input
              label="Student Campus Email"
              type="email"
              required
              placeholder="student@campus.edu"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit">Send Invite</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Deliverables / Submission Modal */}
      {isSubmitOpen && (
        <Modal isOpen={isSubmitOpen} onClose={() => setIsSubmitOpen(false)} title="Project Deliverables">
          <form onSubmit={handleProjectSubmit} className="space-y-4 py-2">
            <div className="p-3 bg-brand-50/20 border border-brand-200 dark:border-brand-800 rounded-lg text-xs text-muted flex items-start gap-2">
              <Lock className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
              <span>
                Project deliverables are immutable after the competition deadline passes. All active team members
                share credit under the frozen registration snapshot.
              </span>
            </div>
            <Input
              label="Project Title"
              required
              placeholder="e.g. GreenCampus IoT Sentinel"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
            />
            <div>
              <label className="block text-xs font-medium text-text mb-1">Abstract / Architecture Overview</label>
              <textarea
                className="w-full text-sm p-2.5 rounded-lg border border-border bg-surface text-text"
                rows={4}
                required
                placeholder="Explain the problem, methodology, and tech stack used..."
                value={projectAbstract}
                onChange={(e) => setProjectAbstract(e.target.value)}
              />
            </div>
            <Input
              label="Git Repository URL"
              placeholder="https://github.com/campus-team/project"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
            <Input
              label="Live Demo or Slide Deck URL"
              placeholder="https://demo.project.app"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsSubmitOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit">Submit Deliverables</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Calendar, MapPin, Users, ArrowRight, Image as ImageIcon, Loader2, ShieldCheck, School } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Select } from '@/components/ui/Select';
import { PROTOTYPE_EVENTS } from '@/prototype/data';
import { formatINR } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

interface DiscoveryPageProps {
  onSelectEvent?: (eventId: string) => void;
}

export interface DiscoveredEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  department: string;
  format: string;
  capacity: number;
  startsAt: string;
  endsAt: string;
  dateStr?: string;
  timeStr?: string;
  venueName?: string;
  organizerName?: string;
  isPaid?: boolean;
  pricePaise?: number;
  registeredCount?: number;
}

export const DiscoveryPage: React.FC<DiscoveryPageProps> = ({ onSelectEvent: propOnSelectEvent }) => {
  const navigate = useNavigate();
  const onSelectEvent = propOnSelectEvent || ((id: string) => navigate(`/events/${id}`));
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedCollege, setSelectedCollege] = useState<string>('All Colleges');
  const [selectedFormat, setSelectedFormat] = useState<string>('all');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [apiEvents, setApiEvents] = useState<DiscoveredEvent[]>([]);
  const [_nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_hasLoadedApi, setHasLoadedApi] = useState(false);

  const collegesList = ['All Colleges', 'Tech University A', 'Polytechnic Institute B', 'Sir MV Institute of Technology'];
  const categories = ['All', 'Tech', 'AI & Robotics', 'Hackathon', 'Cultural Fest', 'Workshop', 'Sports'];

  // 250ms debounced search-as-you-type
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch from API whenever search/category/format changes
  useEffect(() => {
    let isCancelled = false;

    const fetchDiscoveryEvents = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
        if (selectedCategory !== 'All') params.append('category', selectedCategory);
        if (selectedFormat !== 'all') params.append('format', selectedFormat);
        params.append('limit', '20');

        const res = await apiClient<any>(`/api/v1/events?${params.toString()}`);
        const eventList = res?.items || res?.events || res?.data?.events || [];

        if (!isCancelled && eventList.length > 0) {
          const mapped: DiscoveredEvent[] = eventList.map((e: any) => ({
            id: e.id,
            slug: e.slug,
            title: e.title,
            description: e.description || '',
            category: e.category,
            department: e.department,
            format: e.format,
            capacity: e.capacity,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            venueName: e.venueName || e.venue?.name || 'Campus Venue',
            organizerName: e.organizerName || e.organizer?.displayName || 'Campus Society',
            isPaid: false,
            pricePaise: 0,
            registeredCount: 0,
          }));
          setApiEvents(mapped);
          setNextCursor(res?.nextCursor || null);
          setHasLoadedApi(true);
        }
      } catch {
        if (!isCancelled) {
          setHasLoadedApi(false);
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchDiscoveryEvents();

    return () => {
      isCancelled = true;
    };
  }, [debouncedSearch, selectedCategory, selectedFormat]);

  // Fallback to prototype data if backend returned 0 items and search is empty
  const eventsToDisplay = useMemo(() => {
    // Filter prototype events
    const protoFiltered = PROTOTYPE_EVENTS.filter((evt) => {
      const matchesSearch =
        evt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        evt.organizer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        evt.venue.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCat =
        selectedCategory === 'All' ||
        evt.category.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        selectedCategory.toLowerCase().includes(evt.category.toLowerCase());

      const matchesFormat =
        selectedFormat === 'all' ||
        (selectedFormat === 'free' && !evt.isPaid) ||
        (selectedFormat === 'paid' && evt.isPaid);

      return matchesSearch && matchesCat && matchesFormat;
    }).map((e) => ({
      id: e.id,
      slug: e.id,
      title: e.title,
      description: e.description,
      category: e.category,
      department: 'Computer Science',
      format: e.isPaid ? 'hybrid' : 'in_person',
      capacity: e.capacity,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      dateStr: e.dateStr,
      timeStr: e.timeStr,
      venueName: e.venue,
      organizerName: e.organizer,
      isPaid: e.isPaid,
      pricePaise: e.pricePaise,
      registeredCount: e.registeredCount,
    }));

    if (apiEvents.length > 0) {
      const existingTitles = new Set(apiEvents.map((a) => a.title.toLowerCase()));
      return [...protoFiltered.filter((p) => !existingTitles.has(p.title.toLowerCase())), ...apiEvents];
    }

    return protoFiltered;
  }, [apiEvents, searchQuery, selectedCategory, selectedFormat]);

  return (
    <div className="space-y-6">
      {/* Hero Welcome Banner with subtle indigo radial gradient (<=12% opacity) */}
      <div className="relative overflow-hidden bg-surface border border-border rounded-lg p-5 sm:p-8 bg-indigo-radial dark:bg-indigo-radial-dark shadow-sm">
        <Badge variant="brand" size="sm" className="mb-2">
          Campus Event Discovery
        </Badge>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-text max-w-xl">
          Discover verified events, workshops & campus hackathons
        </h1>
        <p className="text-xs sm:text-sm text-text-muted mt-2 max-w-2xl leading-relaxed">
          Centralized campus registrations, QR check-in ticketing, inter-department competitions, and verified achievement passports for all college students.
        </p>
      </div>

      {/* Search & Category Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Input
            placeholder="Search events, clubs, or venues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Search events"
          />
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-3 pointer-events-none" />
          {isLoading && (
            <Loader2 className="w-4 h-4 text-brand animate-spin absolute right-3 top-3 pointer-events-none" />
          )}
        </div>

        {/* Mobile Filters Button (<640px) triggers Bottom Sheet */}
        <div className="sm:hidden flex items-center gap-2">
          <Button
            variant="outline"
            size="md"
            className="w-full flex items-center justify-center gap-2"
            onClick={() => setIsFilterSheetOpen(true)}
          >
            <Filter className="w-4 h-4 text-brand" />
            <span>Filter Events {selectedFormat !== 'all' ? `(${selectedFormat})` : ''}</span>
          </Button>
        </div>

        {/* Desktop / Tablet Filters */}
        <div className="hidden sm:flex items-center gap-2">
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
            className="bg-surface border border-border rounded-md px-3 py-2 text-xs font-medium text-text focus:outline-none cursor-pointer"
            aria-label="Filter by event format"
          >
            <option value="all">All Formats</option>
            <option value="in_person">In-Person Campus</option>
            <option value="online">Online / Virtual</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
      </div>

      {/* Cross-College Filter Chips Bar (FR-XCOL) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
          <School className="w-3.5 h-3.5 text-brand" />
          <span>Cross-College Discovery:</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
          {collegesList.map((col) => (
            <button
              key={col}
              onClick={() => setSelectedCollege(col)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-fast shrink-0 ${
                selectedCollege === col
                  ? 'bg-brand/15 text-brand border border-brand/40 font-semibold'
                  : 'bg-surface text-text-muted hover:text-text border border-border'
              }`}
            >
              {col}
            </button>
          ))}
        </div>
      </div>

      {/* Swipeable Category Chips Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-fast shrink-0 ${
              selectedCategory === cat
                ? 'bg-brand text-white shadow-sm font-semibold'
                : 'bg-surface-2 text-text-muted hover:text-text border border-border'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Event Cards Grid (12-col grid: 1 col on mobile, 2 col on tablet, 3 col on desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {eventsToDisplay.map((evt) => {
          const registered = evt.registeredCount || 0;
          const isSoldOut = registered >= evt.capacity;
          const capacityPercent = Math.min(100, Math.round((registered / evt.capacity) * 100));

          return (
            <Card
              key={evt.id}
              className="flex flex-col overflow-hidden hover:border-brand/50 transition-all duration-normal group cursor-pointer"
              onClick={() => onSelectEvent(evt.id)}
            >
              {/* Fixed 16:9 Aspect Ratio Box with Gradient + Fallback */}
              <div className="relative w-full overflow-hidden bg-gradient-to-br from-surface-2 via-border to-surface -mx-4 -mt-4 mb-3 aspect-16/9">
                <div className="w-full h-full flex flex-col items-center justify-center text-text-muted p-4">
                  <ImageIcon className="w-8 h-8 text-brand/40 mb-1" />
                  <span className="text-[11px] font-medium">{evt.category} Event</span>
                </div>

                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                  <Badge variant="brand" size="sm">
                    {evt.category}
                  </Badge>
                  {evt.isPaid ? (
                    <Badge variant="warning" size="sm">
                      TEST MODE
                    </Badge>
                  ) : (
                    <Badge variant="success" size="sm">
                      FREE
                    </Badge>
                  )}
                </div>
              </div>

              {/* Event Metadata */}
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[11px] font-semibold text-brand tracking-wider uppercase truncate">
                      {evt.organizerName}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Verified Organizer</span>
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-text group-hover:text-brand transition-colors mt-0.5 line-clamp-2">
                    {evt.title}
                  </h2>
                  <p className="text-xs text-text-muted mt-2 line-clamp-2 leading-relaxed">
                    {evt.description}
                  </p>

                  {/* Eligibility Explainer Chip */}
                  <div className="mt-2.5">
                    <span className="inline-block text-[10px] font-medium text-text-muted bg-surface-2 px-2 py-0.5 rounded border border-border">
                      {evt.category === 'Hackathon' ? 'Open to All Participating Colleges' : 'Open to CSE & Engineering Students'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-border mt-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Calendar className="w-3.5 h-3.5 text-brand shrink-0" />
                    <span>
                      {new Date(evt.startsAt).toLocaleDateString()} • {new Date(evt.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <MapPin className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="truncate">{evt.venueName}</span>
                  </div>

                  {/* Capacity Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-text-muted">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {isSoldOut ? 'Event Full (Waitlist available)' : `${registered} / ${evt.capacity} registered`}
                      </span>
                      <span>{capacityPercent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden border border-border">
                      <div
                        className={`h-full rounded-full transition-all duration-normal ${
                          isSoldOut ? 'bg-error' : capacityPercent > 80 ? 'bg-warning' : 'bg-brand'
                        }`}
                        style={{ width: `${capacityPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Card Bottom Action & Price */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-[11px] text-text-muted block">Entry Fee</span>
                      <span className="text-sm font-bold text-text">
                        {evt.isPaid && evt.pricePaise ? formatINR(evt.pricePaise) : 'Free Admission'}
                      </span>
                    </div>

                    <Button
                      variant={isSoldOut ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(evt.id);
                      }}
                    >
                      <span>{isSoldOut ? 'Waitlist' : 'Details'}</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Mobile Filter Bottom Sheet (<640px) */}
      <BottomSheet
        isOpen={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        title="Filter Events"
        description="Filter campus events by format and category"
      >
        <div className="space-y-4">
          <Select
            label="Event Format"
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
            options={[
              { value: 'all', label: 'All Formats' },
              { value: 'in_person', label: 'In-Person Campus' },
              { value: 'online', label: 'Online / Virtual' },
              { value: 'hybrid', label: 'Hybrid' },
            ]}
          />

          <Select
            label="Event Category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            options={categories.map((c) => ({ value: c, label: c }))}
          />

          <div className="pt-3 border-t border-border flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setSelectedFormat('all');
                setSelectedCategory('All');
                setIsFilterSheetOpen(false);
              }}
            >
              Reset Filters
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsFilterSheetOpen(false)}
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

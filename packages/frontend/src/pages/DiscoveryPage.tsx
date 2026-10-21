import React, { useState, useMemo } from 'react';
import { Search, Filter, Calendar, MapPin, Users, ArrowRight, Image as ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Select } from '@/components/ui/Select';
import { PROTOTYPE_EVENTS } from '@/prototype/data';
import { formatINR } from '@/lib/utils';

interface DiscoveryPageProps {
  onSelectEvent: (eventId: string) => void;
}

export const DiscoveryPage: React.FC<DiscoveryPageProps> = ({ onSelectEvent }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedFormat, setSelectedFormat] = useState<string>('all');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const categories = ['All', 'Tech', 'Cultural', 'Workshop', 'Hackathon'];

  const filteredEvents = useMemo(() => {
    return PROTOTYPE_EVENTS.filter((evt) => {
      const matchesSearch =
        evt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        evt.organizer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        evt.venue.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCat = selectedCategory === 'All' || evt.category === selectedCategory;
      const matchesFormat =
        selectedFormat === 'all' ||
        (selectedFormat === 'free' && !evt.isPaid) ||
        (selectedFormat === 'paid' && evt.isPaid);

      return matchesSearch && matchesCat && matchesFormat;
    });
  }, [searchQuery, selectedCategory, selectedFormat]);

  const handleImageError = (id: string) => {
    setImageErrors((prev) => ({ ...prev, [id]: true }));
  };

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
            aria-label="Filter by pricing format"
          >
            <option value="all">All Pricing Types</option>
            <option value="free">Free Events Only</option>
            <option value="paid">Paid (Test Mode)</option>
          </select>
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
        {filteredEvents.map((evt) => {
          const isSoldOut = evt.registeredCount >= evt.capacity;
          const capacityPercent = Math.min(100, Math.round((evt.registeredCount / evt.capacity) * 100));
          const hasImageError = imageErrors[evt.id];

          return (
            <Card
              key={evt.id}
              className="flex flex-col overflow-hidden hover:border-brand/50 transition-all duration-normal group cursor-pointer"
              onClick={() => onSelectEvent(evt.id)}
            >
              {/* Fixed 16:9 or 4:3 Aspect Ratio Image Box with Gradient + Icon Fallback */}
              <div
                className={`relative w-full overflow-hidden bg-gradient-to-br from-surface-2 via-border to-surface -mx-4 -mt-4 mb-3 ${
                  evt.aspectRatio === '4/3' ? 'aspect-4/3' : 'aspect-16/9'
                }`}
              >
                {!hasImageError ? (
                  <img
                    src={evt.imageUrl}
                    alt={evt.title}
                    onError={() => handleImageError(evt.id)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-slow ease-eventora"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-text-muted p-4">
                    <ImageIcon className="w-8 h-8 text-brand/40 mb-1" />
                    <span className="text-[11px] font-medium">{evt.category} Event</span>
                  </div>
                )}

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
                  <span className="text-[11px] font-semibold text-brand tracking-wider uppercase">
                    {evt.organizer}
                  </span>
                  <h2 className="text-base font-bold text-text group-hover:text-brand transition-colors mt-0.5 line-clamp-2">
                    {evt.title}
                  </h2>
                  <p className="text-xs text-text-muted mt-2 line-clamp-2 leading-relaxed">
                    {evt.description}
                  </p>
                </div>

                <div className="space-y-3 pt-4 border-t border-border mt-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Calendar className="w-3.5 h-3.5 text-brand shrink-0" />
                    <span>{evt.dateStr} • {evt.timeStr}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <MapPin className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="truncate">{evt.venue}</span>
                  </div>

                  {/* Capacity Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-text-muted">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {isSoldOut ? 'Event Full (Waitlist available)' : `${evt.registeredCount} / ${evt.capacity} registered`}
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
                        {evt.isPaid ? formatINR(evt.pricePaise) : 'Free Admission'}
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
                      <span>{isSoldOut ? 'Waitlist' : 'Register'}</span>
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
        description="Filter campus events by pricing and category"
      >
        <div className="space-y-4">
          <Select
            label="Pricing Type"
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
            options={[
              { value: 'all', label: 'All Pricing Types' },
              { value: 'free', label: 'Free Admission Only' },
              { value: 'paid', label: 'Paid Events (Test Mode)' },
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

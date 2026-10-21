import React, { useState } from 'react';
import { MapPin, Navigation, Copy, Check, ExternalLink, Info, Accessibility } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

export interface VenueCardProps {
  venueId?: string;
  name: string;
  building: string;
  capacity?: number;
  accessibilityNotes?: string | null;
  directions?: string | null;
  mapUrl?: string | null;
  entryInstructions?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export const VenueCard: React.FC<VenueCardProps> = ({
  name,
  building,
  capacity,
  accessibilityNotes,
  directions,
  mapUrl,
  entryInstructions,
  lat,
  lng,
}) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const effectiveDirections = directions || 'Enter via North Gate elevator to Floor 2. Wheelchair ramp accessible from Campus Courtyard East.';
  const effectiveEntryInstructions = entryInstructions || 'Please arrive 15 minutes prior to session start with your digital QR ticket ready at the door.';
  const effectiveMapUrl = mapUrl || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${building}`)}`);

  const handleCopyDirections = () => {
    navigator.clipboard.writeText(`${name} (${building})\nDirections: ${effectiveDirections}\nEntry Instructions: ${effectiveEntryInstructions}`);
    setCopied(true);
    toast({
      type: 'success',
      title: 'Directions Copied',
      message: 'Venue location and directions copied to clipboard.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="p-4 sm:p-5 border border-border shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-border/70">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-brand/10 text-brand rounded-lg">
            <MapPin className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h3 className="font-bold text-text text-sm sm:text-base leading-tight">{name}</h3>
            <p className="text-xs text-text-muted mt-0.5">{building}</p>
          </div>
        </div>
        {capacity && (
          <Badge variant="neutral" size="sm">
            Capacity: {capacity} attendees
          </Badge>
        )}
      </div>

      {/* Entry Instructions & Accessibility */}
      <div className="space-y-2.5 text-xs">
        {accessibilityNotes && (
          <div className="flex items-start gap-2 p-2.5 bg-surface-2 border border-border rounded-lg text-text">
            <Accessibility className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-text">Accessibility & Inclusion:</span>
              <p className="text-text-muted text-[11px] mt-0.5 leading-relaxed">{accessibilityNotes}</p>
            </div>
          </div>
        )}

        {effectiveEntryInstructions && (
          <div className="flex items-start gap-2 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold">Entry Instructions:</span>
              <p className="text-[11px] mt-0.5 leading-relaxed">{effectiveEntryInstructions}</p>
            </div>
          </div>
        )}

        <div>
          <span className="font-semibold text-text">Walking Directions:</span>
          <p className="text-text-muted text-[11px] mt-1 leading-relaxed">{effectiveDirections}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="pt-2 flex flex-wrap items-center gap-2">
        <a
          href={effectiveMapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-brand text-white hover:bg-brand-hover focus:ring-2 focus:ring-brand focus:outline-none transition-colors"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>Open in Maps</span>
          <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
        </a>

        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyDirections}
          className="flex items-center gap-1.5 text-xs"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy Directions'}</span>
        </Button>
      </div>
    </Card>
  );
};

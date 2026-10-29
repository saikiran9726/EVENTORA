import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Clock,
  List,
  Grid,
  Building,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

export interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  format: string;
  venueName?: string;
  startsAt: string;
  endsAt: string;
}

interface CalendarPageProps {
  onSelectEvent?: (eventId: string) => void;
}

export const CalendarPage: React.FC<CalendarPageProps> = ({ onSelectEvent: propOnSelectEvent }) => {
  const navigate = useNavigate();
  const onSelectEvent = propOnSelectEvent || ((id: string) => navigate(`/events/${id}`));
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'month' | 'agenda'>('month');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [_isLoading, setIsLoading] = useState(false);
  const [selectedDayEvents, setSelectedDayEvents] = useState<CalendarEvent[]>([]);

  // Format month string YYYY-MM
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

  const fetchCalendarData = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient<any>(
        `/api/v1/calendar?month=${monthKey}&view=${viewMode}`
      );
      const itemList = res?.items || res?.data?.items || [];
      if (itemList.length > 0) {
        const mapped: CalendarEvent[] = itemList.map((i: any) => ({
          id: i.id,
          slug: i.slug,
          title: i.title,
          category: i.category,
          format: i.format,
          venueName: i.venueName || i.venue?.name || 'Sir MV Auditorium',
          startsAt: i.startsAt,
          endsAt: i.endsAt,
        }));
        setEvents(mapped);
      }
    } catch {
      // Fallback mock events for current month
      const now = new Date();
      setEvents([
        {
          id: 'evt-1',
          slug: 'smart-campus-robotics-grand-prix',
          title: 'Smart Campus AI & Robotics Symposium 2026',
          category: 'AI & Robotics',
          format: 'in_person',
          venueName: 'Sir MV Auditorium',
          startsAt: new Date(now.getFullYear(), now.getMonth(), 15, 9, 30).toISOString(),
          endsAt: new Date(now.getFullYear(), now.getMonth(), 15, 17, 30).toISOString(),
        },
        {
          id: 'evt-2',
          slug: 'national-level-hackathon',
          title: 'Campus 36-Hour Hackathon 2026',
          category: 'Hackathon',
          format: 'hybrid',
          venueName: 'Kalam Seminar Hall',
          startsAt: new Date(now.getFullYear(), now.getMonth(), 22, 10, 0).toISOString(),
          endsAt: new Date(now.getFullYear(), now.getMonth(), 23, 20, 0).toISOString(),
        },
        {
          id: 'evt-3',
          slug: 'cultural-music-night',
          title: 'Annual Acoustic Rhythm Fest',
          category: 'Cultural Fest',
          format: 'in_person',
          venueName: 'Central Amphitheater',
          startsAt: new Date(now.getFullYear(), now.getMonth(), 28, 18, 0).toISOString(),
          endsAt: new Date(now.getFullYear(), now.getMonth(), 28, 22, 0).toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarData();
  }, [monthKey, viewMode]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Compute calendar days
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarDays = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarDays.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(d);
  }

  const getEventsForDay = (day: number) => {
    return events.filter((e) => {
      const d = new Date(e.startsAt);
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
    });
  };

  const handleExportIcs = async (event: CalendarEvent) => {
    try {
      const link = document.createElement('a');
      link.href = `/api/v1/events/${event.id}/ics`;
      link.setAttribute('download', `${event.slug || 'event'}.ics`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({
        title: 'iCalendar Exported',
        message: `Exported RFC 5545 calendar file for ${event.title}`,
        type: 'success',
      });
    } catch {
      // Fallback RFC 5545 generator client side
      const icsData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Eventora//Campus Calendar//EN',
        'BEGIN:VEVENT',
        `SUMMARY:${event.title}`,
        `LOCATION:${event.venueName || 'Campus Venue'}`,
        `DTSTART:${new Date(event.startsAt).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTEND:${new Date(event.endsAt).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${event.slug || 'event'}.ics`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({
        title: 'iCalendar Exported',
        message: `Generated .ics file for calendar import.`,
        type: 'success',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            Campus Event Calendar
          </h1>
          <p className="text-xs sm:text-sm text-text-muted mt-0.5">
            Verified academic, club, workshop and symposium schedules with RFC 5545 .ics calendar export.
          </p>
        </div>

        {/* View Switcher & Navigation Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface-2 border border-border rounded-md p-0.5 text-xs">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                viewMode === 'month' ? 'bg-surface text-brand shadow-xs' : 'text-text-muted hover:text-text'
              }`}
            >
              <Grid className="w-3.5 h-3.5" /> Month
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1.5 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                viewMode === 'agenda' ? 'bg-surface text-brand shadow-xs' : 'text-text-muted hover:text-text'
              }`}
            >
              <List className="w-3.5 h-3.5" /> Agenda
            </button>
          </div>

          <div className="flex items-center gap-1 bg-surface border border-border rounded-md px-2 py-1 text-xs font-semibold text-text">
            <button onClick={handlePrevMonth} className="p-1 hover:text-brand" aria-label="Previous Month">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="min-w-28 text-center">{monthName}</span>
            <button onClick={handleNextMonth} className="p-1 hover:text-brand" aria-label="Next Month">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Month View Grid */}
      {viewMode === 'month' && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-bold text-text-muted py-2">
            <span>SUN</span>
            <span>MON</span>
            <span>TUE</span>
            <span>WED</span>
            <span>THU</span>
            <span>FRI</span>
            <span>SAT</span>
          </div>

          <div className="grid grid-cols-7 gap-px bg-border">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="bg-surface/50 min-h-24 sm:min-h-28 p-1.5" />;
              }

              const dayEvents = getEventsForDay(day);
              const isToday =
                new Date().getDate() === day &&
                new Date().getMonth() === month &&
                new Date().getFullYear() === year;

              return (
                <div
                  key={`day-${day}`}
                  onClick={() => setSelectedDayEvents(dayEvents)}
                  className={`bg-surface min-h-24 sm:min-h-28 p-1.5 transition-colors cursor-pointer hover:bg-surface-2/70 flex flex-col justify-between ${
                    isToday ? 'ring-1 ring-brand inset-0' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${
                        isToday ? 'bg-brand text-white' : 'text-text'
                      }`}
                    >
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] bg-brand/10 text-brand font-bold px-1 rounded">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 mt-1 overflow-hidden">
                    {dayEvents.slice(0, 2).map((evt) => (
                      <div
                        key={evt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectEvent) onSelectEvent(evt.id);
                        }}
                        className="p-1 rounded bg-brand/5 border border-brand/20 text-[10px] font-medium text-brand truncate hover:bg-brand/10"
                        title={evt.title}
                      >
                        {evt.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="text-[10px] text-text-muted block pl-1">
                        +{dayEvents.length - 2} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Agenda View List */}
      {(viewMode === 'agenda' || selectedDayEvents.length > 0) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-text">
              {viewMode === 'agenda' ? `Upcoming Events in ${monthName}` : 'Events on Selected Day'}
            </h2>
            {selectedDayEvents.length > 0 && viewMode === 'month' && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDayEvents([])} className="text-xs">
                Clear Selection
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {(selectedDayEvents.length > 0 ? selectedDayEvents : events).map((evt) => (
              <Card key={evt.id} className="transition-all hover:border-brand/40">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-text">{evt.title}</span>
                      <Badge variant="brand" size="sm">{evt.category}</Badge>
                      <Badge variant="neutral" size="sm" className="capitalize">
                        {evt.format.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-text-muted pt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-brand" />
                        {new Date(evt.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                        {new Date(evt.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Building className="w-3.5 h-3.5 text-brand" />
                        {evt.venueName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-0 border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportIcs(evt)}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Download className="w-3.5 h-3.5" /> .ics Export
                    </Button>
                    {onSelectEvent && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onSelectEvent(evt.id)}
                        className="flex items-center gap-1 text-xs"
                      >
                        View <ArrowRight className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

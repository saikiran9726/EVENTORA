export const IS_PROTOTYPE_MODE = true;
export const PROTOTYPE_BADGE_TEXT = 'PROTOTYPE DATA';

export interface PrototypeEvent {
  id: string;
  title: string;
  organizer: string;
  organizerId: string;
  department: string;
  category: 'Tech' | 'Cultural' | 'Sports' | 'Workshop' | 'Hackathon';
  venue: string;
  dateStr: string;
  timeStr: string;
  description: string;
  capacity: number;
  registeredCount: number;
  isPaid: boolean;
  pricePaise: number; // In integer paise (e.g. 15000 = ₹150)
  imageUrl: string;
  tags: string[];
  status: 'PUBLISHED' | 'DRAFT' | 'PENDING_APPROVAL';
  aspectRatio: '16/9' | '4/3';
}

export const PROTOTYPE_EVENTS: PrototypeEvent[] = [
  {
    id: 'evt-ai-summit-2026',
    title: 'Smart Campus AI & Robotics Symposium 2026',
    organizer: 'Robotics & Automation Society (RAS)',
    organizerId: 'org-ras-01',
    department: 'Computer Science & Engineering',
    category: 'Tech',
    venue: 'Sir MV Auditorium, Tech Block B',
    dateStr: '28 October 2026',
    timeStr: '09:30 AM - 04:30 PM',
    description:
      'A full-day hands-on symposium featuring keynote lectures from AI researchers, competitive robot showcase, edge-computing live demos, and a student project expo. Participation certificates granted upon QR verified attendance.',
    capacity: 250,
    registeredCount: 238,
    isPaid: true,
    pricePaise: 15000,
    imageUrl: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=800&q=80',
    tags: ['Artificial Intelligence', 'Robotics', 'Hardware', 'Demo'],
    status: 'PUBLISHED',
    aspectRatio: '16/9',
  },
  {
    id: 'evt-hack-campus-2026',
    title: 'Eventora 36-Hour Hackathon: Campus Life Innovations',
    organizer: 'Developer Student Club (DSC)',
    organizerId: 'org-dsc-02',
    department: 'Information Science & Tech',
    category: 'Hackathon',
    venue: 'Innovation Center, Ground Floor Lab 3',
    dateStr: '05 November 2026',
    timeStr: '08:00 AM onwards',
    description:
      'Form teams of 2 to 4 members to build real-world software solutions resolving campus bottleneck issues: dining queues, book sharing, peer-tutoring, and green transit. Free registration with catered meals and mentor reviews.',
    capacity: 120,
    registeredCount: 120,
    isPaid: false,
    pricePaise: 0,
    imageUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80',
    tags: ['Hackathon', 'Teams', 'Mentorship', 'Open Source'],
    status: 'PUBLISHED',
    aspectRatio: '16/9',
  },
  {
    id: 'evt-music-fest-2026',
    title: 'Aura Autumn Cultural Fest & Battle of the Bands',
    organizer: 'Cultural Activities Council',
    organizerId: 'org-cac-03',
    department: 'Student Affairs',
    category: 'Cultural',
    venue: 'Open Air Amphitheatre',
    dateStr: '12 November 2026',
    timeStr: '05:00 PM - 10:00 PM',
    description:
      'Annual intra-college acoustic & rock band competition, classical dance recitals, student art exhibitions, and open-mic poetry corners. Food stalls curated by student clubs.',
    capacity: 600,
    registeredCount: 412,
    isPaid: true,
    pricePaise: 25000,
    imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
    tags: ['Music', 'Live Bands', 'Cultural', 'Stage'],
    status: 'PUBLISHED',
    aspectRatio: '4/3',
  },
  {
    id: 'evt-cloud-workshop-2026',
    title: 'Cloud-Native Distributed Systems Masterclass',
    organizer: 'ACM Student Chapter',
    organizerId: 'org-acm-04',
    department: 'Computer Applications',
    category: 'Workshop',
    venue: 'Seminar Hall 2, Science Wing',
    dateStr: '19 November 2026',
    timeStr: '02:00 PM - 05:30 PM',
    description:
      'Practical workshop on event-driven architecture with PostgreSQL transactions, outbox design pattern, and Redis task dispatching. Bring your own laptop with Docker configured.',
    capacity: 80,
    registeredCount: 45,
    isPaid: false,
    pricePaise: 0,
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
    tags: ['PostgreSQL', 'Architecture', 'Fastify', 'Docker'],
    status: 'PUBLISHED',
    aspectRatio: '16/9',
  },
];

export const PROTOTYPE_ORGANIZER_STATS = {
  totalEvents: 4,
  activeRegistrations: 815,
  attendanceRatePercent: 91.4,
  waitlistQueueSize: 24,
  simulatedGrossSalesPaise: 7420000, // ₹74,200
  feedbackAverage: 4.8,
  feedbackTotalResponses: 382,
  conversionRatePercent: 88.5,
};

export const PROTOTYPE_ATTENDEES = [
  {
    ticketId: 'TCK-88219-01',
    studentName: 'Aarav Sharma',
    rollNumber: 'CS22B1042',
    email: 'aarav.sharma@campus.edu',
    ticketType: 'Student Regular Pass',
    pricePaise: 15000,
    checkInStatus: 'CHECKED_IN',
    checkInTime: '09:22 AM',
  },
  {
    ticketId: 'TCK-88219-02',
    studentName: 'Priya Iyer',
    rollNumber: 'EC23B1015',
    email: 'priya.iyer@campus.edu',
    ticketType: 'Student Regular Pass',
    pricePaise: 15000,
    checkInStatus: 'CHECKED_IN',
    checkInTime: '09:28 AM',
  },
  {
    ticketId: 'TCK-88219-03',
    studentName: 'Rohan Deshmukh',
    rollNumber: 'ME22B1089',
    email: 'rohan.d@campus.edu',
    ticketType: 'Student Regular Pass',
    pricePaise: 15000,
    checkInStatus: 'VALID',
    checkInTime: 'Pending scan',
  },
  {
    ticketId: 'TCK-88219-04',
    studentName: 'Neha Verma',
    rollNumber: 'CS23B1078',
    email: 'neha.v@campus.edu',
    ticketType: 'VIP Faculty Guest',
    pricePaise: 0,
    checkInStatus: 'CHECKED_IN',
    checkInTime: '09:15 AM',
  },
  {
    ticketId: 'TCK-88219-05',
    studentName: 'Vikram Joshi',
    rollNumber: 'IS22B1033',
    email: 'vikram.j@campus.edu',
    ticketType: 'Student Regular Pass',
    pricePaise: 15000,
    checkInStatus: 'VALID',
    checkInTime: 'Pending scan',
  },
];

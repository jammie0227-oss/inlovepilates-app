export interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  color: string;
  bgLight: string;
  border: string;
  text: string;
  isActive: boolean;
}

export interface BookingItem {
  id: string;
  date: string;
  startHour: number;
  startMin: number;
  durationMins: number;
  teacherId: string;
  studentName?: string;
  studentId?: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  status: 'confirmed' | 'cancelled_normal' | 'special_pending' | 'special_approved' | 'special_rejected';
  signed?: boolean;
  signatureData?: string;
  signedAt?: string;
  reason?: string;
  teacherNote?: string;
}

export interface ReviewItem {
  id: string;
  bookingId: string;
  teacherId: string;
  teacherName: string;
  date: string;
  time: string;
  room: string;
  lessonType: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  phone: string;
}

export interface StudentRule {
  id: string;
  freq: string;
  day: string;
  time: string;
  startDate: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
}

export interface PurchaseRecord {
  id: string;
  date: string;
  credits: number;
  price: number;
  teacherSign: string;
  studentSign: string;
  signedAt: string;
}

export interface StudentItem {
  id: string;
  name: string;
  phone: string;
  teacherId: string;
  note: string;
  credits: number;
  defaultLessonType: '1v1' | '1v2'; 
  isTrial: boolean;
  noRegularRule: boolean;
  rules: StudentRule[];
  status: 'active' | 'archived';
  nextLesson?: string;
  purchases: PurchaseRecord[];
}

export interface AuditLogItem {
  id: string;
  time: string;
  actor: string;
  studentName: string;
  action: string;
  typeStr: '簽到' | '取消' | '時間異動' | '教室異動' | '購課' | '設定';
  category: 'red' | 'yellow' | 'normal';
  read: boolean;
  teacherId?: string;
  reviewId?: string;
}
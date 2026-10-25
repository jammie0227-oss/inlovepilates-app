export class ScheduleEngine {
  existingRecords: any[];

  constructor(existingRecords: any[] = []) {
    this.existingRecords = existingRecords.filter((r: any) => r.status !== 'cancelled_normal');
  }

  formatDate(d: Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  checkConflict(fullDateTime: string, roomType: string) {
    const match = this.existingRecords.find(r => `${r.date} ${r.time}` === fullDateTime && r.roomType === roomType);
    if (match) return { isConflict: true, conflictRecord: match };
    return { isConflict: false };
  }

  generateSchedule({
    sid,
    credits,
    slots = [],
    conflictPolicy = 'skip',
    maxWeeksLimit = 12 // 權限：一般老師上限 3 個月 (12 週)
  }: any) {
    if (!slots || slots.length === 0 || credits <= 0) {
      return { success: false, newRecords: [], conflictsFound: [], message: '無效的排課規則或剩餘堂數不足' };
    }

    let earliestStartStr = "2099-12-31";
    slots.forEach((s: any) => {
      if (s.startDate && s.startDate < earliestStartStr) earliestStartStr = s.startDate;
    });
    if (earliestStartStr === "2099-12-31") earliestStartStr = this.formatDate(new Date());

    const startDateObj = new Date(`${earliestStartStr}T00:00:00`);
    const maxAllowedDate = new Date(startDateObj);
    maxAllowedDate.setDate(maxAllowedDate.getDate() + maxWeeksLimit * 7);

    const newRecords: any[] = [];
    const conflictsFound: any[] = [];
    let scheduledCount = 0;
    let currentDate = new Date(`${earliestStartStr}T00:00:00`);
    let safetyLoop = 0;
    let hitMaxLimit = false;

    while (scheduledCount < credits && safetyLoop < 1000) {
      safetyLoop++;
      if (currentDate > maxAllowedDate) {
        hitMaxLimit = true;
        break;
      }

      const dayOfWeekStr = ['日', '一', '二', '三', '四', '五', '六'][currentDate.getDay()];
      const dateStr = this.formatDate(currentDate);
      const matchedSlots = slots.filter((s: any) => s.day === dayOfWeekStr);

      for (const slot of matchedSlots) {
        if (scheduledCount >= credits) break;

        if (dateStr >= slot.startDate) {
          const fullDateTime = `${dateStr} ${slot.time}`;
          const conflictCheck = this.checkConflict(fullDateTime, slot.roomType || 'small');

          if (conflictCheck.isConflict) {
            conflictsFound.push({ date: fullDateTime, conflictWith: conflictCheck.conflictRecord });
            if (conflictPolicy === 'skip') {
              continue;
            } else if (conflictPolicy === 'cancel') {
              return { success: false, newRecords: [], conflictsFound, message: `在 [${fullDateTime}] 發現撞期，排課終止。` };
            }
          }

          newRecords.push({
            id: `auto-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            sid,
            date: dateStr,
            time: slot.time,
            lessonType: slot.lessonType || '1v1',
            roomType: slot.roomType || 'small',
            status: 'confirmed'
          });
          scheduledCount++;
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      success: true,
      newRecords,
      conflictsFound,
      hitMaxLimit,
      message: hitMaxLimit 
        ? `因 3 個月 (12週) 權限限制，已預排 ${newRecords.length} 堂課，剩餘 ${credits - newRecords.length} 堂需由管理員排定。`
        : `成功依規則自動排入 ${newRecords.length} 堂課程！`
    };
  }
}
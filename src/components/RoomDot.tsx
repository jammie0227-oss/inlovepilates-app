import React from 'react';
import { ROOM_DOT_CLASS, ROOM_NAME } from '../utils/bookingRules';

/** 教室識別色點：大教室紫色、小教室綠色 */
export function RoomDot({ room }: { room: 'large' | 'small' }) {
  return (
    <span
      role="img"
      aria-label={ROOM_NAME[room]}
      title={ROOM_NAME[room]}
      className={`inline-block w-2 h-2 rounded-full align-middle mx-0.5 shrink-0 ${ROOM_DOT_CLASS[room]}`}
    />
  );
}

// 🟣 / 🟢 為舊通知資料的寫法，一併換成色點
const DOT_PATTERN = /(\[\[large\]\]|\[\[small\]\]|🟣|🟢)/;

/** 通知文字：將教室標記換成色點 */
export function NoticeText({ text }: { text: string }) {
  return (
    <>
      {text.split(DOT_PATTERN).map((part, i) => {
        if (part === '[[large]]' || part === '🟣') return <RoomDot key={i} room="large" />;
        if (part === '[[small]]' || part === '🟢') return <RoomDot key={i} room="small" />;
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

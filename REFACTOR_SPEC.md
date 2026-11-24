# InLove Pilates 排課與結算系統 — 最終版業務邏輯與重構規格書

## 一、 核心資料模型與系統常數 (Single Source of Truth)
全站所有分頁（Tab 1 ~ Tab 5）共用同一套底層資料結構，
為後續對接 Supabase（`src/lib/supabase.ts`）做準備：

* **場地與時段常數**：
  * 單堂標準時長 `durationMins = 50`（保留 10 分鐘粒度的開始時間選擇，
    分鐘陣列 `['00', '10', '20', '30', '40', '50']`）。
  * 教室空間：`roomType: 'large' | 'small'`（🟣 大教室 / 🟢 小教室）。
  * 課程類別：`lessonType: '1v1' | '1v2'`。
* **動態營業時間設定 (`businessHours`)**：
  * 儲存於全域狀態，並於 **Tab 5 管理員設定區** 提供管理員編輯（一般老師為唯讀檢視）：
    * `weekday`（週一至週五）：預設開啟，`09:00` – `22:00`。
    * `saturday`（週六）：預設開啟，`11:00` – `18:00`。
    * `sunday`（週日）：**預設關閉（公休）**，管理員可隨時勾選開啟並自訂起訖小時。
* **全局基準日 (`systemBaseDate`)**：
  * 全站判定「過去 / 今天 / 未來」與「是否逾期」的唯一時間基準。
* **課堂狀態 (`status`)**：
  * `'confirmed'`：正常有效預約。
  * `'cancelled_normal'`：一般提前取消（不扣堂、釋出空位）。
  * `'special_pending'`：待管理員審核之申請（包含 24H 內異動、非營業時間預約），
   **審核期間在排班總覽完全釋出空位（不卡時段）**。
  * `'special_approved'`：管理員核准（釋出空位免罰，或非營業時間預約核准生效）。
  * `'special_rejected'`：管理員駁回（釋出空位並累積老師計罰，或非營業時間預約駁回不成立）。

---

## 二、 排課規則、教室調度與預約防護網

### 1. 教室分配與自動調度（開放老師手動微調，衝突時以系統為主）
* **預設配對**：新增預約選擇 `1v1` 時預設帶入 `small`（小教室）；
                      選擇 `1v2` 時預設帶入 `large`（大教室）；
                     管理員預設一律優先 `large`。
* **允許一般老師手動調整教室（4 種碰撞處理邏輯）**：
  1. **情境 A（1v1 手動選大教室，且大教室空閒）**：
       允許預約成功；但系統標記其具備「可讓位權」，若後續有其他老師預約同時段 `1v2` 大教室且當時小教室有空，系統將**自動把這堂 1v1 移至小教室**並發送調度通知。
  2. **情境 B（1v1 手動選大教室，但大教室已滿）**：以系統為主，自動將該筆預約導回 `small`（小教室）成立，並提示「大教室該時段已滿，系統已自動為您改排至小教室」。
  3. **情境 C（1v2 手動選小教室）**：若大教室有空，系統強制導回大教室；
    僅在大教室滿額且無法觸發 1v1 讓位時，才允許暫排小教室並觸發全站紅色警示橫條。
  4. **情境 D（事後變更教室）**：開課前 24 小時以上允許依上述規則調整；
      **開課前 24 小時內**禁止一般老師自行變更，須送審由管理員處理。
* **大教室智慧讓位 (`canAutoSwap`)**：預約 `1v2` 進大教室時，必須確認小教室在**完整 50 分鐘區間內**皆無衝突，才可將原大教室之 `1v1` 課堂自動移至小教室並同時成立兩筆預約。

### 2. 「審核中 (`special_pending`)」完全釋出空位（絕不卡時段）
* **業務原則**：審核是為了讓管理員裁決計罰或放行，絕不卡住教室資源。
* 凡是 `status === 'special_pending'`（無論 24H 內取消/改期，或非營業時間申請），在 Tab 1 排班總覽日曆與週曆上一律隱藏，且在 `checkGlobalConflict` 衝堂檢測中**視同空位（不佔用教室空間）**。
* 僅在 Tab 3 學員預排清單中顯示該筆待審核紀錄並計入學員已佔用額度（防止自動排課溢出）。

### 3. 預約時間邊界與優先權防護
* **非營業時間預約提醒與送審 (`reviewType: 'after_hours'`)**：
  * 行事曆對照 `businessHours` 將非營業時間與公休日標示為淡灰斜線底。
  * 一般老師硬要在非營業時間（或週日公休）預約時，跳出確認提醒，填寫事由後建立 `status: 'special_pending'` 預約並送出 `after_hours` 審核單至 Tab 5（管理員直接放行不需送審）。
* **臨時預約截止時間**：
  * **一般老師**：必須在**開課前 1 小時（60 分鐘）**以前新增預約，超過則阻擋。
  * **管理員 Daisy**：在**開課前 10 分鐘**以前皆可新增預約。
* **提前預約天數上限**：
  * **一般老師**：最多只能預約未來 **3 個月（90 天）**內的時段，超過則阻擋；管理員無限制。
* **固定老師優先時段 (`priorityGrid`) 兩週保護**：
  * Tab 5 設定的優先時段，在**距離上課超過 14 天（兩週）**時，
    僅限該優先老師本人（或管理員）可預約；**進入開課前 14 天內**自動解鎖，開放所有老師預約。
* **隱私遮罩 (`checkGlobalConflict`)**：一般老師撞到別人的課（僅空間衝突）時，僅提示「該時段教室已有預約 (1v1/1v2)」，隱藏老師與學員姓名。

---

## 三、 簽到、系統代簽憑證與結算更正審核

### 1. 狀態標籤優先級（全站統一元件 `BookingStatusBadge`）
所有課堂狀態標籤統一由 `src/components/SignatureModals.tsx` 的`BookingStatusBadge` 
渲染（**Tab 2、Tab 3、Tab 4 明細列表全部統一引用**），嚴格遵守以下 4 層順序：
1. **⚡ 系統代簽 (`settlementType === 'system_deducted' || isSystemSigned`)**：月底結算由系統自動代扣 1 堂（橘色標籤）並認列老師鐘點費。
2. **✕ 未到課 (`settlementType === 'unattended_no_credit_deducted'`)**：學生無故未到且未取消，不扣學員堂數。
3. **補簽 (`isLateSigned === true`)**：手寫簽名送出時，若 `booking.date < systemBaseDate`，自動標記為逾期補簽（黃色標籤）並扣 1 堂。
4. **已簽到 (`signed === true`)**：準時手寫簽名完成（綠色標籤）並扣 1 堂。
*(若有手寫筆跡 `signatureData` 為 Base64 圖片，同步顯示縮圖並支援點擊開啟 `SignatureZoomModal` 放大檢視)。*

### 2. 「⚡ 系統代簽」透明對帳憑證
* 在 **Tab 2 與 Tab 3 的歷史課堂卡片**中，凡屬 `⚡ 系統代簽` 紀錄，必須在卡片內顯示系統代結時間（`systemSignedAt`）與老師填寫的具體原因（`overdueReason`），作為學員與老師對帳依據。

### 3. 「月底結算更正 (Undo)」防弊審核機制
* **提交即鎖定**：老師在 Tab 2 提交「月底結算逾期處理」後，該筆課堂標記為 `isSettlementLocked: true`，老師端不可自行撤銷。
* **申請更正流程**：若老師填錯，需點擊 **`申請結算更正`** 並填寫事由，送出一筆 `reviewType: 'settlement_undo'` 案件至 Tab 5（`reviews`）。
* **管理員核准回滾**：管理員 Daisy 在 Tab 5 點擊「核准更正」後，系統自動回滾課堂狀態並退還/扣除對應的學員堂數（`credits`），同時寫入稽核日誌；駁回則維持原狀。

### 4. 免費特殊取消額度提示與統計口徑
* **免費特殊取消額度級距（顯示於 Tab 5 審核卡片輔助裁決）**：
  * 未滿 20 堂（0–19 堂）：`0 次`（無免費額度）。
  * 滿 20 堂（20 堂）：`1 次`。
  * 21–40 堂：`2 次`；41–60 堂：`3 次`（以此類推，每加 20 堂 +1 次）。
  * Tab 5 審核卡片自動計算並顯示該老師「本月已上堂數 / 免費額度 / 已使用次數」，最終由管理員按「免罰」或「計罰」人工裁決。
* **Tab 4 授課統計口徑**：`getTeacherStats` 計算 1v1 / 1v2 已授課堂數時，必須加上條件 `&& (b.signed || b.settlementType === 'system_deducted')`，排除尚未上課的未來預約。
* **簽到欠堂提醒**：執行 `onSign` 前，若學員 `credits <= 0`，跳出 `confirm` 確認視窗提示「該學員剩餘堂數為 0，簽到後將成為負數（欠堂），確定繼續嗎？」。

---

## 四、 程式碼重構執行任務清單 (Actionable Tasks)

1. **任務 1 — 抽離型別與預設設定至 `src/types.ts`**：
   將 `src/mockData.ts` 頂部的介面移入 `src/types.ts` 並補齊 `BusinessHoursConfig`、`isSystemSigned`、`systemSignedAt`、`isSettlementLocked` 欄位（`reviewType` 支援 `'cancel' | 'reschedule' | 'after_hours' | 'settlement_undo'`），讓 `mockData.ts` 從 `./types` re-export。
2. **任務 2 — 建立共用規則檔 `src/utils/bookingRules.ts`**：
   抽離 `BUSINESS_MINUTES`、`DEFAULT_BUSINESS_HOURS`、`getStudentBookingPreset`、`isBookingOverdue`、`isCancelledBooking`（確保 `special_pending` 視同空位）、`resolveRoomAssignment`（處理 A/B/C 教室自動導正與讓位）、`checkBookingTimeConstraints`（驗證營業時間、1 小時/10 分鐘截止、3 個月上限、優先時段前兩週保護）、`calculateFreeCancelQuota`（計算 20 堂免費取消額度）。
3. **任務 3 — 建立共用彈窗 `src/components/BookingEditModal.tsx`**：
   整併 Tab 2 與 Tab 3 重複的 `editingBooking` Modal，套用 `bookingRules.ts` 規則與 24H 內異動必填事由防呆。
4. **任務 4 — 清理與拆分 `src/components/Tab3StudentManagement.tsx`**：
   刪除頂部殘留的孤立畫布事件函式（`getCoord`, `start`, `draw`, `stop`, `clear`），並將 `StudentDetailView` 獨立拆分為 `src/components/StudentDetailView.tsx`，讓 `Tab2PersonalSchedule.tsx` 與 `StudentDetailView.tsx` 改用 `BookingEditModal` 與 `bookingRules.ts`。
5. **任務 5 — 落實全站對帳、營業時間設定與審核邏輯**：
   * 修改 `Tab5RulesAndAudit.tsx`：新增「工作室營業時間設定」卡片（週一～五、週六、週日預設關閉可開啟）；審核列表支援 `after_hours` 與 `settlement_undo`，並顯示老師當月免費取消額度計算提示。
   * 修改 `Tab1StudioCalendar.tsx`：確保 `status === 'special_pending'` 隱藏且不佔用教室；行事曆標示非營業時間底色；預約時套用 `checkBookingTimeConstraints`（非營業時間跳提醒送審）與 `resolveRoomAssignment`。
   * 修改 `Tab4TeachersManagement.tsx`：月份明細列表統一改用 `<BookingStatusBadge/>`，並修正 `getTeacherStats` 只統計 `signed || settlementType === 'system_deducted'` 的已授課堂數。
   * 修改 `Tab2PersonalSchedule.tsx` 與 `src/app/page.tsx`：系統代簽卡片顯示 `systemSignedAt` 與 `overdueReason` 對帳憑證；實作 `isSettlementLocked`、`settlement_undo` 申請與回滾；執行 `onSign` 前若學員 `credits <= 0` 跳出欠堂確認提示。
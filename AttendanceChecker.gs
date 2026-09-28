// AttendanceChecker.gs
// Feature A: 前営業日分の勤怠連絡について
//   (1) 出勤時・退勤時それぞれの投稿有無をチェック
//   (2) 出勤時投稿(本日の予定)の項目が、退勤時投稿(本日の実績)で消化されているかをLLMで判定
//   (3) 投稿が無い/1件のみの場合、事前連絡(数日前の投稿での予告)や当日連絡(体調不良等の急な連絡)による
//       休暇でないかをLLMで確認し、確認できた場合は問題としてカウントしない
// 問題(投稿漏れ、または予定未消化)がある場合のみアラートスペースに通知する。
// 休暇が確認できたメンバーは、他に問題があればその補足として、他に問題が無ければ軽い一言として
// あわせてアラートスペースに投稿する(勤怠チェックが正常に機能していることが分かるように)。

// 事前連絡(数日前の投稿での予告)を拾うためにさかのぼる日数
const LEAVE_ANNOUNCEMENT_LOOKBACK_DAYS = 14;

/** 本番実行用。問題があれば実際にアラートスペースへ投稿する。 */
function checkPreviousBusinessDayPosts() {
  runAttendanceCheck_(false);
}

/**
 * 動作確認用。ロジックは本番と同じだが、実際には投稿せず
 * 実行ログに投稿予定の内容を表示するだけ(Chatスペースは汚さない)。
 */
function testCheckPreviousBusinessDayPosts() {
  runAttendanceCheck_(true);
}

function runAttendanceCheck_(dryRun) {
  const targetDate = getPreviousBusinessDay_(new Date());
  const { start, end } = getDayRange_(targetDate);

  const lookbackStart = new Date(start);
  lookbackStart.setDate(lookbackStart.getDate() - LEAVE_ANNOUNCEMENT_LOOKBACK_DAYS);

  // 対象日分のみのメッセージだけでなく、事前連絡(数日前の投稿)を拾えるよう
  // さかのぼった範囲もまとめて1回で取得しておく。
  const recentMessages = listMessagesInSpace_(ATTENDANCE_SPACE_ID, lookbackStart, end);
  const messages = recentMessages.filter((m) => {
    const t = new Date(m.createTime);
    return t >= start && t < end;
  });
  const userIdMap = getMemberUserIdMap_(); // email -> "users/{id}"

  const reportLines = [];
  const leaveLines = [];

  MEMBERS.forEach((member) => {
    const userId = userIdMap[member.email];
    if (!userId) {
      Logger.log('WARNING: no user ID mapping for ' + member.email + ' — SetupOneTime.gs を参照');
      return;
    }

    const memberMessages = messages
      .filter((m) => m.sender && m.sender.name === userId)
      .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

    if (memberMessages.length === 0 || memberMessages.length === 1) {
      const missingDescription =
        memberMessages.length === 0
          ? '出勤時・退勤時どちらの投稿も確認できません'
          : '投稿が1件のみです(出勤時・退勤時のいずれかが未投稿の可能性)';

      const leaveReason = detectLeaveAnnouncement_(member, userId, targetDate, recentMessages);
      if (leaveReason) {
        leaveLines.push('・' + member.name + ': ' + leaveReason);
      } else {
        reportLines.push('・' + member.name + ': ' + missingDescription);
      }
      return;
    }

    const arrivalText = memberMessages[0].text || '';
    const departureText = memberMessages[memberMessages.length - 1].text || '';
    const mismatch = checkPlanVsResultAlignment_(arrivalText, departureText);
    if (mismatch) {
      reportLines.push('・' + member.name + ': ' + mismatch);
    }
  });

  if (reportLines.length === 0 && leaveLines.length === 0) {
    Logger.log('No issues found for ' + formatDateJp_(targetDate));
    return;
  }

  let text;
  if (reportLines.length > 0) {
    text = formatDateJp_(targetDate) + '(前営業日)の勤怠連絡チェックで気になる点があります:\n' + reportLines.join('\n');
    if (leaveLines.length > 0) {
      text += '\n\n(休暇を確認できたため対象外としたメンバー)\n' + leaveLines.join('\n');
    }
  } else {
    text = formatDateJp_(targetDate) + '(前営業日)の勤怠連絡チェック: 休暇を確認できました\n' + leaveLines.join('\n');
  }

  if (dryRun) {
    Logger.log('[DRY RUN] 投稿はせず、内容のみ表示します:\n' + text);
    return;
  }

  postToAlertSpace_(text);
  Logger.log('Posted alert:\n' + text);
}

/**
 * 出勤時・退勤時の投稿が0件または1件しか無いメンバーについて、
 * 事前連絡(数日前の投稿内での予告)または当日連絡(急な休みの連絡)によって
 * 対象日が休暇であると分かるかをLLMで判定する。
 * 休暇が確認できればその理由(短い説明)を返し、確認できなければnullを返す。
 */
function detectLeaveAnnouncement_(member, userId, targetDate, recentMessages) {
  const memberRecentMessages = recentMessages
    .filter((m) => m.sender && m.sender.name === userId)
    .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

  if (memberRecentMessages.length === 0) {
    return null;
  }

  const history = memberRecentMessages
    .map((m) => '[' + formatDateTimeJp_(new Date(m.createTime)) + ']\n' + (m.text || ''))
    .join('\n\n---\n\n');

  const systemPrompt = [
    'あなたは勤怠チェックアシスタントです。',
    'ある社員の直近の投稿履歴(日時つき)を見て、指定された対象日にその社員が',
    '休暇(有給・夏休み等の事前連絡、または体調不良等による当日の急な連絡)であることが',
    '読み取れるかどうかを判定してください。',
    '',
    '判定のポイント:',
    '- 対象日より前の投稿で「◯/◯,◯は休み(夏休み・有給など)を頂いております」のように',
    '  対象日を含む期間の休暇を予告している場合は休暇とみなす。',
    '- 対象日当日の投稿で「本日お休みします」のように急な休みを連絡している場合も休暇とみなす。',
    '- 単に業務予定が書かれているだけで休暇に触れていない場合は休暇とみなさない。',
    '',
    '出力形式は厳密に次のいずれかにしてください。',
    '- 休暇が確認できない場合は "NO_LEAVE" という1単語だけを出力する。',
    '- 休暇が確認できた場合は1行で "LEAVE: " に続けて、いつの投稿で分かったか(日付)と',
    '  休暇理由を日本語で簡潔に書く。',
  ].join('\n');

  const userPrompt =
    '【対象日】' +
    formatDateJp_(targetDate) +
    '\n\n【' +
    member.name +
    'さんの直近の投稿履歴(古い順)】\n' +
    history;

  const response = callClaude_(systemPrompt, userPrompt).trim();
  if (response.indexOf('LEAVE') !== 0) {
    return null;
  }
  return response.replace(/^LEAVE:\s*/i, '').trim();
}

/**
 * 出勤時投稿(予定)と退勤時投稿(実績)をClaudeに比較させる。
 * 問題なければ null、未消化の予定があればその説明文字列を返す。
 */
function checkPlanVsResultAlignment_(arrivalText, departureText) {
  const systemPrompt = [
    'あなたは日報チェックアシスタントです。',
    'ある社員の「出勤時投稿(本日の予定)」と「退勤時投稿」を比較します。',
    '退勤時投稿は通常「本日の業務(実績)」と「明日の業務予定」の2セクションで構成されています。',
    '',
    '判定ルール:',
    '出勤時に予定していた項目それぞれについて、退勤時投稿の**どちらかのセクションに一度でも登場すれば**',
    '「対応済み」とみなしてください。具体的には次のいずれかに該当すれば対応済みです。',
    '  (a) 「本日の業務(実績)」に完了・進行中などとして記載されている',
    '  (b) 「明日の業務予定」に再掲されている(=今日はできず翌営業日に繰り越したという意思表示とみなす)',
    '「明日の業務予定」への再掲は、繰越の正常な報告であり問題ではありません。',
    '',
    '問題として報告すべきなのは、出勤時の予定項目が',
    '「本日の業務(実績)」にも「明日の業務予定」にも**どちらにも一切登場しない**、',
    '完全に消えてしまっている項目だけです。',
    '',
    '出力形式は厳密に次のいずれかにしてください。',
    '- 上記の意味で問題となる項目が無ければ、"MATCH" という1単語だけを出力する。',
    '- 問題となる項目がある場合は、1行目に "MISMATCH" とだけ書き、',
    '  2行目以降に箇条書きで「消えている予定項目: 補足」の形式で簡潔に列挙する。',
    '',
    '表現が違うだけで内容的に対応していれば登場しているとみなしてよい(表記揺れは許容)。',
    '出勤時の予定になかった新規対応が退勤時投稿に含まれているのは問題ないので無視してよい。',
  ].join('\n');

  const userPrompt =
    '【出勤時投稿(本日の予定)】\n' + arrivalText + '\n\n【退勤時投稿(本日の実績+明日の業務予定)】\n' + departureText;

  const response = callClaude_(systemPrompt, userPrompt).trim();
  if (response === 'MATCH' || response.indexOf('MATCH') === 0) {
    return null;
  }
  return response.replace(/^MISMATCH\s*/i, '').trim();
}

function getPreviousBusinessDay_(fromDate) {
  const d = new Date(fromDate);
  do {
    d.setDate(d.getDate() - 1);
  } while (!isBusinessDay_(d)); // 土日・祝日をスキップ
  return d;
}

// Googleが公開している日本の祝日カレンダー
const JAPANESE_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

/** 土日・日本の祝日・会社独自の休日(CompanyHolidays.gs)のいずれでもなければ true。 */
function isBusinessDay_(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) {
    return false;
  }
  return !isCompanyHoliday_(date) && !isJapaneseHoliday_(date);
}

/**
 * 日本の祝日(振替休日・国民の休日を含む)なら true。
 * このカレンダーには節分・七夕などの祝日ではない行事(説明が「祭日」)も含まれるため、
 * 説明が「祝日」のイベントだけを祝日として扱う。
 */
function isJapaneseHoliday_(date) {
  const calendar = CalendarApp.getCalendarById(JAPANESE_HOLIDAY_CALENDAR_ID);
  if (!calendar) {
    throw new Error('日本の祝日カレンダーを取得できませんでした: ' + JAPANESE_HOLIDAY_CALENDAR_ID);
  }
  return calendar.getEventsForDay(date).some((event) => event.getDescription().indexOf('祝日') !== -1);
}

/** 動作確認用。直近1年分の祝日カレンダーのイベントと、祝日として扱うかどうかをログに出す。 */
function testJapaneseHolidays() {
  const calendar = CalendarApp.getCalendarById(JAPANESE_HOLIDAY_CALENDAR_ID);
  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  calendar.getEvents(start, end).forEach((event) => {
    const isHoliday = event.getDescription().indexOf('祝日') !== -1;
    Logger.log(
      formatDateJp_(event.getAllDayStartDate()) + ' ' + event.getTitle() + ' → ' + (isHoliday ? '祝日(スキップ)' : '対象外')
    );
  });
}

function getDayRange_(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start, end: end };
}

function formatDateJp_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd');
}

function formatDateTimeJp_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

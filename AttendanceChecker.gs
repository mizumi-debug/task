// AttendanceChecker.gs
// Feature A: 前営業日分の勤怠連絡について
//   (1) 出勤時・退勤時それぞれの投稿有無をチェック
//   (2) 出勤時投稿(本日の予定)の項目が、退勤時投稿(本日の実績)で消化されているかをLLMで判定
// 問題(投稿漏れ、または予定未消化)がある場合のみアラートスペースに通知する。

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

  const messages = listMessagesInSpace_(ATTENDANCE_SPACE_ID, start, end);
  const userIdMap = getMemberUserIdMap_(); // email -> "users/{id}"

  const reportLines = [];

  MEMBERS.forEach((member) => {
    const userId = userIdMap[member.email];
    if (!userId) {
      Logger.log('WARNING: no user ID mapping for ' + member.email + ' — SetupOneTime.gs を参照');
      return;
    }

    const memberMessages = messages
      .filter((m) => m.sender && m.sender.name === userId)
      .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

    if (memberMessages.length === 0) {
      reportLines.push('・' + member.name + ': 出勤時・退勤時どちらの投稿も確認できません');
      return;
    }
    if (memberMessages.length === 1) {
      reportLines.push('・' + member.name + ': 投稿が1件のみです(出勤時・退勤時のいずれかが未投稿の可能性)');
      return;
    }

    const arrivalText = memberMessages[0].text || '';
    const departureText = memberMessages[memberMessages.length - 1].text || '';
    const mismatch = checkPlanVsResultAlignment_(arrivalText, departureText);
    if (mismatch) {
      reportLines.push('・' + member.name + ': ' + mismatch);
    }
  });

  if (reportLines.length === 0) {
    Logger.log('No issues found for ' + formatDateJp_(targetDate));
    return;
  }

  const text =
    formatDateJp_(targetDate) + '(前営業日)の勤怠連絡チェックで気になる点があります:\n' + reportLines.join('\n');

  if (dryRun) {
    Logger.log('[DRY RUN] 投稿はせず、内容のみ表示します:\n' + text);
    return;
  }

  postToAlertSpace_(text);
  Logger.log('Posted alert:\n' + text);
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
  } while (d.getDay() === 0 || d.getDay() === 6); // 土日をスキップ
  return d;
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

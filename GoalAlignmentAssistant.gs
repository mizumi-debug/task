// GoalAlignmentAssistant.gs
// Feature B: 部/チーム/個人の目標と、直近の日報投稿(実タスク)を突き合わせ、
// 目標達成に向けて追従できているかをLLMに評価させ、週次でアラートスペースに要約を投稿する。

const GOAL_ALIGNMENT_LOOKBACK_DAYS = 7;
const INDIVIDUAL_SHEET_DUMP_MAX_CHARS = 8000;

/** 本番実行用。要約を実際にアラートスペースへ投稿する。 */
function runWeeklyGoalAlignmentCheck() {
  runGoalAlignmentCheck_(false);
}

/** 動作確認用。投稿はせず、実行ログに要約を表示するだけ。 */
function testWeeklyGoalAlignmentCheck() {
  runGoalAlignmentCheck_(true);
}

function runGoalAlignmentCheck_(dryRun) {
  const reports = MEMBERS.map(buildMemberGoalAlignmentReport_).filter(Boolean);

  if (reports.length === 0) {
    Logger.log('直近の投稿が無いなどの理由で、目標整合性の要約は生成されませんでした。');
    return;
  }

  const text = '今週の目標整合性チェック(' + formatDateJp_(new Date()) + '):\n\n' + reports.join('\n\n');

  if (dryRun) {
    Logger.log('[DRY RUN] 投稿はせず、内容のみ表示します:\n' + text);
    return;
  }

  postToAlertSpace_(text);
  Logger.log('Posted weekly goal alignment summary.');
}

/**
 * 1名分の「目標 vs 直近タスク」の整合性をLLMに評価させ、レポート文字列を返す。
 * 直近投稿が無い場合はnull(Feature Aの抜け漏れチェック側で別途検知されるため、ここではスキップ)。
 */
function buildMemberGoalAlignmentReport_(member) {
  const userIdMap = getMemberUserIdMap_();
  const userId = userIdMap[member.email];
  if (!userId) {
    Logger.log('WARNING: no user ID mapping for ' + member.email);
    return null;
  }

  const recentPosts = fetchRecentPostsText_(userId, GOAL_ALIGNMENT_LOOKBACK_DAYS);
  if (!recentPosts) {
    Logger.log(member.name + ': 直近' + GOAL_ALIGNMENT_LOOKBACK_DAYS + '日分の投稿が無いためスキップします。');
    return null;
  }

  const departmentGoals = fetchGoalRowsText_('部の目標', DEPARTMENT_GOAL_ROWS);
  const teamGoals = fetchGoalRowsText_('チームの目標', TEAM_GOAL_ROWS);
  const individualGoalDump = fetchIndividualGoalSheetDump_(member);

  const systemPrompt = [
    'あなたは目標達成を支援するアシスタントです。',
    'これから「対象者の担当領域」「部の目標」「チームの目標」「個人評価シートの内容」「直近の日報投稿(実際のタスク)」を渡します。',
    '個人評価シートの内容は、評価シートのセルをそのままテキスト化したものです。',
    '全社目標・チーム目標・個人目標の一覧表や、具体的な取り組み(アソビモバリュー目標)などが雑多に含まれているので、',
    'その中から今回の判断に関係する目標を読み取ってください。',
    '今日の日付から見て現在の四半期・期間に該当する目標を優先的に参照してください。',
    '',
    '重要: 「部の目標」「チームの目標」には、対象者の担当領域以外の目標(他のメンバーの担当分野)も',
    '混在していることがあります。評価は必ず対象者の担当領域に関係する目標・タスクだけに限定し、',
    '担当外の分野については触れないでください(進捗が無いことを指摘するのもNGです)。',
    '',
    'これらをもとに、直近の実際のタスク(日報投稿)が「部の目標」「チームの目標」「個人の目標」',
    'それぞれに対してきちんと追従できているかを評価してください。',
    '',
    '出力形式は必ず次の3ブロックに分け、日本語・簡潔(各ブロック2〜3行程度)で書いてください。',
    'ブロックの見出し以外の前置きや全体まとめは不要です。',
    '',
    '【部の目標】',
    '良い点: (部の目標に沿っている直近の行動。無ければ「特になし」)',
    '不足点: (部の目標に対して不足・進捗が見えない点。無ければ「特になし」)',
    '',
    '【チームの目標】',
    '良い点: (同上)',
    '不足点: (同上)',
    '',
    '【個人の目標】',
    '良い点: (同上)',
    '不足点: (同上)',
    '',
    '断定的な評価は避け、あくまで参考情報・気づきを提供するトーンで書いてください。',
  ].join('\n');

  const userPrompt = [
    '今日の日付: ' + formatDateJp_(new Date()),
    '対象者の担当領域: ' + member.role,
    '',
    departmentGoals,
    '',
    teamGoals,
    '',
    '【個人評価シートの内容(参考、雑多な内容を含む)】',
    individualGoalDump,
    '',
    '【直近' + GOAL_ALIGNMENT_LOOKBACK_DAYS + '日間の日報投稿】',
    recentPosts,
  ].join('\n');

  const summary = callClaude_(systemPrompt, userPrompt).trim();
  return '■' + member.name + '\n' + summary;
}

/** 共有目標シートの指定行(period列・text列)をテキスト化する。 */
function fetchGoalRowsText_(label, rows) {
  const ss = SpreadsheetApp.openById(SHARED_GOALS_SHEET_ID);
  const sheet = getSheetByGid_(ss, getCurrentPeriodGid_('shared'));

  const lines = rows
    .map((row) => {
      const period = sheet.getRange(row, GOAL_PERIOD_COL).getDisplayValue().trim();
      const text = sheet.getRange(row, GOAL_TEXT_COL).getDisplayValue().trim();
      return text ? '[' + period + '] ' + text : '';
    })
    .filter(Boolean);

  return '【' + label + '】\n' + lines.join('\n');
}

/** 個人評価シートの使用範囲を、雑にテキスト化して返す(空セル・空行は除去)。 */
function fetchIndividualGoalSheetDump_(member) {
  const ss = SpreadsheetApp.openById(member.goalSheetId);
  const sheet = getSheetByGid_(ss, getCurrentPeriodGid_(member.email));
  const values = sheet.getDataRange().getDisplayValues();

  const lines = values
    .map((row) => row.map((cell) => cell.trim()).filter((cell) => cell !== ''))
    .filter((row) => row.length > 0)
    .map((row) => row.join(' | '));

  let dump = lines.join('\n');
  if (dump.length > INDIVIDUAL_SHEET_DUMP_MAX_CHARS) {
    dump = dump.substring(0, INDIVIDUAL_SHEET_DUMP_MAX_CHARS) + '\n...(以下省略)';
  }
  return dump;
}

/** スプレッドシート内から指定gidのシート(タブ)を探す。 */
function getSheetByGid_(spreadsheet, gid) {
  const sheet = spreadsheet.getSheets().find((s) => s.getSheetId() === gid);
  if (!sheet) {
    throw new Error('gid ' + gid + ' のシートが見つかりません(spreadsheetId: ' + spreadsheet.getId() + ')');
  }
  return sheet;
}

/** 直近days日間に、指定ユーザーが勤怠連絡スペースに投稿した内容をまとめて返す。投稿が無ければnull。 */
function fetchRecentPostsText_(userId, days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return fetchPostsInRangeText_(userId, start, end);
}

/** [start, end) の期間に、指定ユーザーが勤怠連絡スペースに投稿した内容をまとめて返す。投稿が無ければnull。 */
function fetchPostsInRangeText_(userId, start, end) {
  const messages = listMessagesInSpace_(ATTENDANCE_SPACE_ID, start, end)
    .filter((m) => m.sender && m.sender.name === userId)
    .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

  if (messages.length === 0) {
    return null;
  }

  return messages
    .map((m) => '[' + Utilities.formatDate(new Date(m.createTime), 'Asia/Tokyo', 'MM/dd HH:mm') + ']\n' + (m.text || ''))
    .join('\n\n---\n\n');
}

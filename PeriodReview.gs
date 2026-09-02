// PeriodReview.gs
// Feature Bの拡張: 四半期ごとのテキストチェック、半期ごとの面談準備のために、
// 直近1週間ではなく期間全体(四半期/半期)の投稿をまとめてLLMに評価させる。
// レビュー自体は面談日程などの都合で変わるため手動実行だが、
// 実行を忘れないよう期末が近づいたらChatにリマインドだけ自動投稿する。

const REVIEW_REMINDER_LEAD_DAYS = 5; // 期末の何日前にリマインドするか

/** 毎日実行され、四半期末・半期末が近ければアラートスペースにリマインドを投稿する。 */
function onDailyPeriodReviewReminderCheck() {
  const today = new Date();
  maybePostQuarterlyReminder_(today);
  maybePostHalfYearReminder_(today);
}

function maybePostQuarterlyReminder_(today) {
  const range = getCurrentFiscalQuarterRange_(today);
  if (daysUntil_(today, range.end) !== REVIEW_REMINDER_LEAD_DAYS) return;

  const lastDay = formatDateJp_(new Date(range.end.getTime() - 1));
  postToAlertSpace_(
    [
      '【リマインド】今四半期の終わり(' + lastDay + ')が近づいています。四半期チェックの準備をお願いします。',
      '',
      '1. 下のリンクからApps Scriptを開く',
      '2. 上部の関数選択ドロップダウンから testQuarterlyReview を選び、▷(実行)ボタンを押す(投稿はされず、ログにのみ内容が出ます)',
      '3. 実行ログの内容を確認し、問題なければ同じ手順で runQuarterlyReview を実行する(このスペースに正式に投稿されます)',
      '',
      getScriptEditorUrl_(),
    ].join('\n')
  );
  Logger.log('Posted quarterly review reminder.');
}

function maybePostHalfYearReminder_(today) {
  const range = getCurrentFiscalHalfRange_(today);
  if (daysUntil_(today, range.end) !== REVIEW_REMINDER_LEAD_DAYS) return;

  const lastDay = formatDateJp_(new Date(range.end.getTime() - 1));
  postToAlertSpace_(
    [
      '【リマインド】今半期の終わり(' + lastDay + ')が近づいています。面談準備の作成をお願いします。',
      '',
      '1. 下のリンクからApps Scriptを開く',
      '2. 上部の関数選択ドロップダウンから testHalfYearReview を選び、▷(実行)ボタンを押す(投稿はされず、ログにのみ内容が出ます)',
      '3. 実行ログの内容を確認し、問題なければ同じ手順で runHalfYearReview を実行する(このスペースに正式に投稿されます)',
      '',
      getScriptEditorUrl_(),
    ].join('\n')
  );
  Logger.log('Posted half-year review reminder.');
}

/** このApps Scriptプロジェクトのエディタを直接開くURL。 */
function getScriptEditorUrl_() {
  return 'https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit';
}

/** todayからtoまでの日数(暦日、時刻は無視)を返す。 */
function daysUntil_(today, to) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight - todayMidnight) / oneDayMs);
}

/** 本番実行: 今四半期分のレビューを作成し、アラートスペースに投稿する。 */
function runQuarterlyReview() {
  runPeriodReview_(getCurrentFiscalQuarterRange_(new Date()), '四半期', 'quarterly', false);
}

/** 動作確認用: 投稿せずログにのみ表示する。 */
function testQuarterlyReview() {
  runPeriodReview_(getCurrentFiscalQuarterRange_(new Date()), '四半期', 'quarterly', true);
}

/** 本番実行: 今半期分のレビュー(面談準備用)を作成し、アラートスペースに投稿する。 */
function runHalfYearReview() {
  runPeriodReview_(getCurrentFiscalHalfRange_(new Date()), '半期', 'half', false);
}

/** 動作確認用: 投稿せずログにのみ表示する。 */
function testHalfYearReview() {
  runPeriodReview_(getCurrentFiscalHalfRange_(new Date()), '半期', 'half', true);
}

function runPeriodReview_(range, periodLabel, purpose, dryRun) {
  const reports = MEMBERS.map((member) => buildMemberPeriodReport_(member, range, periodLabel, purpose)).filter(
    Boolean
  );

  if (reports.length === 0) {
    Logger.log('対象期間の投稿が無いなどの理由で、' + periodLabel + 'レビューは生成されませんでした。');
    return;
  }

  const rangeLabel = formatDateJp_(range.start) + ' 〜 ' + formatDateJp_(new Date(range.end.getTime() - 1));
  const title = purpose === 'half' ? '半期面談準備まとめ' : '四半期チェックまとめ';
  const text = title + '(' + rangeLabel + '):\n\n' + reports.join('\n\n');

  if (dryRun) {
    Logger.log('[DRY RUN]\n' + text);
    return;
  }

  postToAlertSpace_(text);
  Logger.log('Posted ' + periodLabel + ' review.');
}

function buildMemberPeriodReport_(member, range, periodLabel, purpose) {
  const userIdMap = getMemberUserIdMap_();
  const userId = userIdMap[member.email];
  if (!userId) {
    Logger.log('WARNING: no user ID mapping for ' + member.email);
    return null;
  }

  const posts = fetchPostsInRangeText_(userId, range.start, range.end);
  if (!posts) {
    Logger.log(member.name + ': 対象期間の投稿が無いためスキップします。');
    return null;
  }

  const departmentGoals = fetchGoalRowsText_('部の目標', DEPARTMENT_GOAL_ROWS);
  const teamGoals = fetchGoalRowsText_('チームの目標', TEAM_GOAL_ROWS);
  const individualGoalDump = fetchIndividualGoalSheetDump_(member);

  const purposeNote =
    purpose === 'half'
      ? 'これは半期に一度の面談の準備資料です。達成度の振り返りに加えて、面談で確認・相談すべき論点があれば1〜2点補足してください。'
      : 'これは四半期に一度の簡易チェック用です。簡潔にまとめてください。';

  const systemPrompt = [
    'あなたは目標達成を支援するアシスタントです。',
    'これから「対象者の担当領域」「部の目標」「チームの目標」「個人評価シートの内容」' +
      '「' + periodLabel + '全体の日報投稿」を渡します。',
    '個人評価シートの内容は、評価シートのセルをそのままテキスト化したものです。',
    'その中から今回の判断に関係する目標を読み取ってください。',
    '個人評価シートの中には「結果・成果【本人】」という欄があり、本人が自己申告した成果が',
    '記載されています(まだ記入されていない場合もあります)。これは重要な一次情報なので、',
    '日報投稿の内容と合わせて総合的に判断材料としてください。',
    '',
    '重要: 「部の目標」「チームの目標」には、対象者の担当領域以外の目標(他のメンバーの担当分野)も',
    '混在していることがあります。評価は必ず対象者の担当領域に関係する目標・タスクだけに限定し、',
    '担当外の分野については触れないでください(進捗が無いことを指摘するのもNGです)。',
    '',
    purposeNote,
    '',
    periodLabel + '全体を通して、実際のタスク(日報投稿)と、個人評価シートの「結果・成果【本人】」の',
    '記載内容を総合し、「部の目標」「チームの目標」「個人の目標」それぞれに対してきちんと',
    '追従できていたかを評価してください。両者に食い違いがあれば、その点にも触れてください。',
    '',
    '出力形式は必ず次の3ブロックに分け、日本語・簡潔に書いてください。',
    'ブロックの見出し以外の前置きや全体まとめは不要です。',
    '',
    '【部の目標】',
    '良い点: (部の目標に沿っていた行動・成果。無ければ「特になし」)',
    '不足点: (部の目標に対して不足していた点。無ければ「特になし」)',
    '',
    '【チームの目標】',
    '良い点: (同上)',
    '不足点: (同上)',
    '',
    '【個人の目標】',
    '良い点: (同上)',
    '不足点: (同上)',
  ].join('\n');

  const userPrompt = [
    '対象期間: ' + formatDateJp_(range.start) + ' 〜 ' + formatDateJp_(new Date(range.end.getTime() - 1)),
    '対象者の担当領域: ' + member.role,
    '',
    departmentGoals,
    '',
    teamGoals,
    '',
    '【個人評価シートの内容(参考、雑多な内容を含む)】',
    individualGoalDump,
    '',
    '【' + periodLabel + '全体の日報投稿】',
    posts,
  ].join('\n');

  const summary = callClaude_(systemPrompt, userPrompt).trim();
  return '■' + member.name + '\n' + summary;
}

/** 今日を含む会計四半期(4月始まり: 4-6/7-9/10-12/1-3月)の [start, end) を返す。 */
function getCurrentFiscalQuarterRange_(date) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  let startMonth;
  if (month >= 4 && month <= 6) startMonth = 4;
  else if (month >= 7 && month <= 9) startMonth = 7;
  else if (month >= 10 && month <= 12) startMonth = 10;
  else startMonth = 1;

  const start = new Date(year, startMonth - 1, 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 3);
  return { start: start, end: end };
}

/** 今日を含む会計半期(4月始まり: 4-9月/10-3月)の [start, end) を返す。 */
function getCurrentFiscalHalfRange_(date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  let start;
  if (month >= 4 && month <= 9) {
    start = new Date(year, 3, 1); // 4/1
  } else if (month >= 10) {
    start = new Date(year, 9, 1); // 10/1
  } else {
    start = new Date(year - 1, 9, 1); // 前年10/1
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6);
  return { start: start, end: end };
}

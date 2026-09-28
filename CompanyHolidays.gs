// CompanyHolidays.gs
// 年末年始など、日本の祝日カレンダーに載っていない会社独自の休日を管理する。
// アラート用の個人スペースに「12/29〜1/4は休みです」のように投稿すると、
// 毎朝の勤怠チェック時にLLMで日付を読み取り、休日としてScript Propertiesに登録する。
// 登録済みの休日は土日・祝日と同じく営業日から除外される(isBusinessDay_を参照)。
// アラート用スペースは本人しかいない個人スペースなので、人が書いた投稿はすべて休日の連絡として扱う。

const COMPANY_HOLIDAYS_PROP = 'COMPANY_HOLIDAYS_JSON'; // ["2026-12-29", ...]
const COMPANY_HOLIDAYS_LAST_SYNC_PROP = 'COMPANY_HOLIDAYS_LAST_SYNC'; // ISO日時
// 初回の読み取りでさかのぼる日数
const COMPANY_HOLIDAYS_INITIAL_LOOKBACK_DAYS = 60;
// これより古い休日は登録から外す(Script Propertyの肥大化防止)
const COMPANY_HOLIDAYS_RETENTION_DAYS = 400;

/** 手動実行用。アラート用スペースの新しい投稿から休日を読み取って登録し、結果を投稿する。 */
function syncCompanyHolidays() {
  syncCompanyHolidaysFromAlertSpace_();
}

/** 動作確認用。現在登録されている会社独自の休日をログに表示する。 */
function logCompanyHolidays() {
  Logger.log('登録済みの会社独自の休日: ' + (getCompanyHolidays_().join(', ') || '(なし)'));
}

function isCompanyHoliday_(date) {
  return getCompanyHolidays_().indexOf(formatDateKey_(date)) !== -1;
}

function getCompanyHolidays_() {
  const value = PropertiesService.getScriptProperties().getProperty(COMPANY_HOLIDAYS_PROP);
  return value ? JSON.parse(value) : [];
}

/**
 * 前回の読み取り以降にアラート用スペースへ人が投稿したメッセージから休日の追加・取り消しを読み取り、
 * 登録内容を更新する。変更があった場合はアラート用スペースに登録結果を投稿する。
 */
function syncCompanyHolidaysFromAlertSpace_() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const lastSync = props.getProperty(COMPANY_HOLIDAYS_LAST_SYNC_PROP);
  let since;
  if (lastSync) {
    since = new Date(lastSync);
  } else {
    since = new Date(now);
    since.setDate(since.getDate() - COMPANY_HOLIDAYS_INITIAL_LOOKBACK_DAYS);
  }

  // Webhookの投稿(BOT)は除き、本人の投稿だけを対象にする
  const messages = listMessagesInSpace_(getAlertSpaceId_(), since, now)
    .filter((m) => m.sender && m.sender.type === 'HUMAN' && m.text)
    .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

  const holidays = getCompanyHolidays_();
  const added = [];
  const removed = [];

  messages.forEach((m) => {
    const changes = extractCompanyHolidayChanges_(m.text, new Date(m.createTime));
    changes.add.forEach((d) => {
      if (holidays.indexOf(d) === -1) {
        holidays.push(d);
        added.push(d);
      }
    });
    changes.remove.forEach((d) => {
      const i = holidays.indexOf(d);
      if (i !== -1) {
        holidays.splice(i, 1);
        removed.push(d);
      }
    });
  });

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - COMPANY_HOLIDAYS_RETENTION_DAYS);
  const cutoffKey = formatDateKey_(cutoff);
  const kept = holidays.filter((d) => d >= cutoffKey).sort();

  props.setProperty(COMPANY_HOLIDAYS_PROP, JSON.stringify(kept));
  props.setProperty(COMPANY_HOLIDAYS_LAST_SYNC_PROP, now.toISOString());

  if (added.length === 0 && removed.length === 0) {
    Logger.log('No company holiday changes. Registered: ' + (kept.join(', ') || '(none)'));
    return;
  }

  const lines = [];
  if (added.length > 0) {
    lines.push(
      '休日として登録しました(勤怠チェックの対象外になります): ' + added.sort().map(formatDateKeyJp_).join(', ')
    );
  }
  if (removed.length > 0) {
    lines.push(
      '休日の登録を取り消しました(勤怠チェックの対象に戻ります): ' + removed.sort().map(formatDateKeyJp_).join(', ')
    );
  }
  const text = '【会社の休日の登録】\n' + lines.join('\n');
  postToAlertSpace_(text);
  Logger.log('Posted company holiday update:\n' + text);
}

/**
 * 1件の投稿から、休日として追加する日付・取り消す日付をLLMで読み取る。
 * 戻り値: { add: ["yyyy-MM-dd", ...], remove: ["yyyy-MM-dd", ...] }
 */
function extractCompanyHolidayChanges_(text, postedAt) {
  const systemPrompt = [
    'あなたは休日登録アシスタントです。',
    'チームリーダーが書いたメモを読み、チームの休日(年末年始・会社の特別休暇など)として',
    '追加する日付と、以前登録した休日を取り消す(出勤日に戻す)日付を読み取ってください。',
    '',
    '判定のポイント:',
    '- 「12/29〜1/4は休み」のような期間指定は、期間内のすべての日付に展開する(土日も含めてよい)。',
    '- 年が書かれていない場合は、投稿日時以降で最も近いその日付の年とみなす。',
    '- 「12/30はやっぱり出勤」のように休みを取り消す内容は remove に入れる。',
    '- 休日に関係の無いメモであれば add・remove とも空にする。',
    '',
    '出力は次の形式のJSONだけにしてください(説明文やコードブロックは付けない)。',
    '{"add": ["yyyy-MM-dd", ...], "remove": ["yyyy-MM-dd", ...]}',
  ].join('\n');

  const userPrompt = '【投稿日時】' + formatDateTimeJp_(postedAt) + '\n\n【メモ】\n' + text;

  const response = callClaude_(systemPrompt, userPrompt);
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) {
    Logger.log('WARNING: could not parse holiday response: ' + response);
    return { add: [], remove: [] };
  }
  const parsed = JSON.parse(match[0]);
  const isDateKey = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  return {
    add: (parsed.add || []).filter(isDateKey),
    remove: (parsed.remove || []).filter(isDateKey),
  };
}

/** ALERT_WEBHOOK_URL (https://chat.googleapis.com/v1/spaces/XXXX/messages?...) からスペースIDを取り出す。 */
function getAlertSpaceId_() {
  const match = getScriptProp_('ALERT_WEBHOOK_URL').match(/\/(spaces\/[^/?]+)\//);
  if (!match) {
    throw new Error('ALERT_WEBHOOK_URL からスペースIDを取得できませんでした。');
  }
  return match[1];
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function formatDateKeyJp_(dateKey) {
  return dateKey.replace(/-/g, '/');
}

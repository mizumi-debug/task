// SetupOneTime.gs
// 初回セットアップ時にだけ手動実行する関数群。SETUP.md の手順から呼び出す。

/**
 * 勤怠連絡スペースの直近メッセージから登場する送信者ID(users/{id})を一覧表示する。
 * 実行後、Apps Scriptエディタの「実行ログ」を見て、投稿内容と照らし合わせて
 * どのIDが誰か目視で特定し、setMemberUserIdMap_() に渡すこと。
 */
function dumpDistinctSenders() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 14); // 直近2週間分

  const messages = listMessagesInSpace_(ATTENDANCE_SPACE_ID, start, end);
  const seen = {};
  messages.forEach((m) => {
    if (!m.sender || !m.sender.name) return;
    const key = m.sender.name;
    if (!seen[key]) {
      seen[key] = { count: 0, sample: m.text ? m.text.substring(0, 40) : '' };
    }
    seen[key].count++;
  });

  Logger.log('=== 直近14日間に投稿した users/{id} 一覧 ===');
  Object.keys(seen).forEach((userId) => {
    Logger.log(userId + '  (投稿数: ' + seen[userId].count + ', 冒頭: "' + seen[userId].sample + '")');
  });
  Logger.log('上記のIDと投稿内容を見比べて誰の投稿か特定し、setMemberUserIdMap_() を実行してください。');
}

/**
 * dumpDistinctSenders_() の結果をもとに、実際のIDを埋めて1回だけ実行する。
 * 例:
 *   setMemberUserIdMap_({
 *     'k_kou@asobimo.com': 'users/1234567890',
 *     'y_ono@asobimo.com': 'users/2345678901',
 *     'pillow_kitagawa@asobimo.com': 'users/3456789012',
 *   });
 */
function setMemberUserIdMap_(map) {
  setScriptProp_('MEMBER_USER_ID_MAP_JSON', JSON.stringify(map));
  Logger.log('Saved MEMBER_USER_ID_MAP_JSON: ' + JSON.stringify(map));
}

/**
 * dumpDistinctSendersの結果から特定したメンバー分のIDを保存する、実行専用の一時関数。
 * 実行して保存を確認したら、この関数ごと削除してpushし直してよい。
 */
function applyMemberUserIdMap() {
  setMemberUserIdMap_({
    'k_kou@asobimo.com': 'users/104715465412828610736',
    'y_ono@asobimo.com': 'users/116152513437845905182',
    'pillow_kitagawa@asobimo.com': 'users/103161311455224551250',
    'm_izumi@asobimo.com': 'users/109425342489579445558',
  });
}

/**
 * 現在の期(部/チーム目標シート、および各メンバーの個人評価シート)のタブ(gid)を保存する。
 *
 * 半期ごとに新しいタブが追加され、この対応関係は変わっていく。期が切り替わったら
 * (例: 2026/10になったら)、Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」で
 * CURRENT_PERIOD_GIDS_JSON の値を直接書き換えれば良い(コードの変更・pushは不要)。
 * 値の例: {"shared":173269677,"k_kou@asobimo.com":2008699027,...}
 */
function applyCurrentPeriodGids() {
  setScriptProp_(
    'CURRENT_PERIOD_GIDS_JSON',
    JSON.stringify({
      shared: 173269677,
      'k_kou@asobimo.com': 2008699027,
      'y_ono@asobimo.com': 829583110,
      'pillow_kitagawa@asobimo.com': 1971513590,
      'm_izumi@asobimo.com': 708705692,
    })
  );
  Logger.log('Saved CURRENT_PERIOD_GIDS_JSON: ' + getScriptProp_('CURRENT_PERIOD_GIDS_JSON'));
}


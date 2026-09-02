// Config.gs
// 固定設定値とScript Propertiesのラッパー

const ATTENDANCE_SPACE_ID = 'spaces/AAAAYuqZ348'; // [マーケ本部] 勤怠連絡

// goalSheetId(スプレッドシート自体のID)は期が変わっても不変。
// タブ(gid)は半期ごとに新しいシートが追加されるため、Script Propertiesの
// CURRENT_PERIOD_GIDS_JSON で管理する(getCurrentPeriodGid_を参照)。
const MEMBERS = [
  {
    name: '黄卉',
    email: 'k_kou@asobimo.com',
    role: '広告運用',
    goalSheetId: '1Vn73mqK7Lw1Po57yUVYK0PslNG46JIwX7WA8IezU9aI',
  },
  {
    name: '大野勇貴',
    email: 'y_ono@asobimo.com',
    role: '生放送',
    goalSheetId: '1GF3sizYuTuKq_o8oh9Y1jPUH0u1Y2cYMvj889HFavKo',
  },
  {
    name: 'ピロー北側',
    email: 'pillow_kitagawa@asobimo.com',
    role: '生放送',
    goalSheetId: '1Uo4B-LVtmOhcoDFeIkhB2r42VUY1E3Ouu0j6kmWTe4g',
  },
];

// 部の目標・チームの目標が載っている共有スプレッドシート(スプレッドシートID自体は不変)
const SHARED_GOALS_SHEET_ID = '1Ua79iFX44UU9C7y1bLRaUtp3JQgrM-XXOmjrUnjD_Zs';
const DEPARTMENT_GOAL_ROWS = [3, 4, 5];
const TEAM_GOAL_ROWS = [9, 10, 11];
const GOAL_PERIOD_COL = 4; // D列
const GOAL_TEXT_COL = 5; // E列

function getScriptProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Script Property "' + key + '" が未設定です。SETUP.md の初期セットアップ手順を確認してください。');
  }
  return value;
}

function setScriptProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/** email -> "users/{id}" のマップ。SetupOneTime.gs の setMemberUserIdMap_() で1回だけ設定する。 */
function getMemberUserIdMap_() {
  return JSON.parse(getScriptProp_('MEMBER_USER_ID_MAP_JSON'));
}

/**
 * 半期ごとに変わる「現在の期」のタブ(gid)を取得する。
 * keyは 'shared'(部/チーム目標シート) または各メンバーのemail。
 * 値はScript Property CURRENT_PERIOD_GIDS_JSON にJSONで保存されており、
 * 期が変わったらApps Scriptの「スクリプト プロパティ」画面から値を書き換えるだけでよい
 * (コードの変更・pushは不要)。
 */
function getCurrentPeriodGid_(key) {
  const map = JSON.parse(getScriptProp_('CURRENT_PERIOD_GIDS_JSON'));
  const gid = map[key];
  if (gid === undefined) {
    throw new Error(
      'CURRENT_PERIOD_GIDS_JSON に "' + key + '" のgidが設定されていません。スクリプト プロパティを確認してください。'
    );
  }
  return gid;
}

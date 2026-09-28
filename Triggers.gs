// Triggers.gs
// 時間主導トリガーのインストールと、トリガーから呼ばれるエントリーポイント。

function installTriggers() {
  removeTriggers_('onDailyAttendanceCheck');
  removeTriggers_('onWeeklyGoalAlignmentCheck');
  removeTriggers_('onDailyPeriodReviewReminderCheck');

  ScriptApp.newTrigger('onDailyAttendanceCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(0)
    .inTimezone('Asia/Tokyo')
    .create();

  ScriptApp.newTrigger('onWeeklyGoalAlignmentCheck')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(10)
    .inTimezone('Asia/Tokyo')
    .create();

  ScriptApp.newTrigger('onDailyPeriodReviewReminderCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(20)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log(
    'Installed triggers: daily attendance check (9:00), weekly goal alignment check (Mon 9:10), ' +
      'daily period-review reminder check (9:20), Asia/Tokyo.'
  );
}

function removeTriggers_(handlerFunctionName) {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === handlerFunctionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function onDailyAttendanceCheck() {
  // 休日の連絡は土日・休日中にも投稿されうるので、スキップ判定より前に毎日読み取る。
  // 読み取りに失敗しても勤怠チェック自体は続行する(次回の実行で改めて読み取られる)。
  try {
    syncCompanyHolidaysFromAlertSpace_();
  } catch (e) {
    Logger.log('WARNING: failed to sync company holidays: ' + e);
  }

  const today = new Date();
  if (!isBusinessDay_(today)) {
    Logger.log('Today is a weekend or holiday; skipping attendance check.');
    return;
  }
  checkPreviousBusinessDayPosts();
}

function onWeeklyGoalAlignmentCheck() {
  runWeeklyGoalAlignmentCheck();
}

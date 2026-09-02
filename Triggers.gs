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
  const today = new Date();
  if (today.getDay() === 0 || today.getDay() === 6) {
    Logger.log('Today is a weekend; skipping attendance check.');
    return;
  }
  checkPreviousBusinessDayPosts();
}

function onWeeklyGoalAlignmentCheck() {
  runWeeklyGoalAlignmentCheck();
}

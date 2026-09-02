// ChatClient.gs
// 読み取り: Google Chat REST API (chat.googleapis.com) をユーザー認証
// (UrlFetchApp + ScriptApp.getOAuthToken) で呼び出す薄いラッパー。
// 書き込み(アラート投稿): Incoming Webhook経由(OAuth・アプリ登録いずれも不要)。

const CHAT_API_BASE = 'https://chat.googleapis.com/v1';

function chatApiRequest_(method, path, params, payload) {
  let url = CHAT_API_BASE + path;
  if (params) {
    const query = Object.keys(params)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    if (query) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + query;
    }
  }

  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    muteHttpExceptions: true,
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Chat API error ' + code + ' for ' + method + ' ' + path + ': ' + body);
  }
  return body ? JSON.parse(body) : {};
}

/**
 * 指定スペース内で startTime <= createTime < endTime のメッセージを全件取得する(ページング対応)。
 * startTime/endTime は Date オブジェクト。
 */
function listMessagesInSpace_(spaceId, startTime, endTime) {
  const filter =
    'create_time > "' + startTime.toISOString() + '" AND create_time < "' + endTime.toISOString() + '"';
  let messages = [];
  let pageToken = null;
  do {
    const params = { filter: filter, pageSize: 100 };
    if (pageToken) params.pageToken = pageToken;
    const result = chatApiRequest_('GET', '/' + spaceId + '/messages', params, null);
    messages = messages.concat(result.messages || []);
    pageToken = result.nextPageToken || null;
  } while (pageToken);
  return messages;
}

/**
 * アラート用スペースにIncoming Webhook経由でメッセージを投稿する。
 * WebhookはOAuth不要・Chatアプリ登録不要で使えるシンプルな投稿手段。
 * URLはアラート用スペースの「アプリと統合」から発行し、Script Property
 * "ALERT_WEBHOOK_URL" に保存しておく(SETUP.md参照)。
 */
function postToAlertSpace_(text) {
  const webhookUrl = getScriptProp_('ALERT_WEBHOOK_URL');
  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Webhook post error ' + code + ': ' + response.getContentText());
  }
}

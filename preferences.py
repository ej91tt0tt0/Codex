"""Explicit, bounded voice commands; never execute code or change credentials."""
import re
import unicodedata

DEFAULTS = {'reply_style':'normal', 'speech_register':'casual', 'speech_speed':'1.12', 'custom_preferences':''}
CHOICES = {'reply_style':('short','normal','detailed'), 'speech_register':('casual','polite'), 'speech_speed':('1.0','1.12','1.25')}
HELP = '「設定変更、返答を短くして」「設定変更、声をゆっくりにして」「設定変更、声かけを止めて」が使えるよ。会話ルールも設定できるよ。コードの改善は「改善リクエスト、内容」で保存できる。'

def parse_command(text):
    text = unicodedata.normalize('NFKC', text).strip()
    match = re.match(r'^(?:(?:よりそい|アスター|(?i:aster))[、,\s]*)?(改善リクエスト|システム改善|改善依頼)[、,:：\s]*(.*)$',text,re.S)
    if match:
        content=match.group(2).strip()
        return {'kind':'request','content':content[:2000]} if content else {'kind':'help'}
    match = re.match(r'^(?:(?:よりそい|アスター|(?i:aster))[、,\s]*)?(設定変更|設定を変更して|システム設定)[、,:：\s]*(.*)$',text,re.S)
    if not match:return None
    body=match.group(2).strip()
    if re.fullmatch(r'(?:初期設定に戻して|会話の設定を戻して|初期設定)',body.rstrip('。')):
        return {'kind':'settings','changes':dict(DEFAULTS),'labels':['会話の話し方を初期設定に戻した']}
    if re.fullmatch(r'会話ルール(?:を|は)?(?:消して|削除して|リセットして)',body.rstrip('。')):
        return {'kind':'settings','changes':{'custom_preferences':''},'labels':['追加の会話ルールを消した']}
    custom=re.match(r'^会話ルール[、,:：\sは]*(.+)$',body,re.S)
    if custom:
        return {'kind':'settings','changes':{'custom_preferences':custom.group(1).strip()[:500]},'labels':['会話ルールを保存した']}
    changes={};labels=[]
    if re.search(r'テーマ.*(?:話題|提案)|話題提案',body):
        if re.search(r'減ら|控え|止め|やめ|停止|オフ|しない',body):changes['proactive_topics']='false';labels.append('テーマを使う話題提案をオフにした')
        elif re.search(r'再開|オン|有効|始め',body):changes['proactive_topics']='true';labels.append('テーマを使う話題提案をオンにした')
    if re.search(r'常時待ち受け|常時音声|ハンズフリー',body):
        if re.search(r'止め|やめ|停止|オフ|しない|無効',body):changes['hands_free']='false';labels.append('常時待ち受けをオフにした')
        elif re.search(r'再開|オン|有効|始め',body):changes['hands_free']='true';labels.append('常時待ち受けをオンにした')
    for pattern,key,label in ((r'Web検索|ウェブ検索|ネット検索','web_search','AIのWeb検索'),(r'AIの自動収集|AI自動収集|AIの定時調査','ai_collect','AIの定時調査')):
        if re.search(pattern,body,re.I):
            if re.search(r'止め|やめ|停止|オフ|しない|無効',body):changes[key]='false';labels.append(label+'をオフにした')
            elif re.search(r'再開|オン|有効|始め',body):changes[key]='true';labels.append(label+'をオンにした')
    if re.search(r'返答|回答|説明',body):
        if re.search(r'短く|簡潔|一言',body):changes['reply_style']='short';labels.append('返答を短めにした')
        elif re.search(r'詳しく|長く|詳細',body):changes['reply_style']='detailed';labels.append('返答を詳しめにした')
        elif re.search(r'普通|通常|戻',body):changes['reply_style']='normal';labels.append('返答を普通の長さにした')
    if re.search(r'声|話す速|読み上げ|発声',body):
        if re.search(r'ゆっくり|遅く',body):changes['speech_speed']='1.0';labels.append('話す速さをゆっくりにした')
        elif re.search(r'速く|早く',body):changes['speech_speed']='1.25';labels.append('話す速さを速めにした')
        elif re.search(r'普通の速|速さを戻|標準の速',body):changes['speech_speed']='1.12';labels.append('話す速さを標準に戻した')
    if re.search(r'タメ口|ため口|敬語[はを]?使わない|敬語[はを]?やめ',body):changes['speech_register']='casual';labels.append('タメ口にした')
    elif re.search(r'敬語(?:を使|に|で)',body):changes['speech_register']='polite';labels.append('敬語にした')
    if re.search(r'声かけ|独り言|話しかけ',body):
        if re.search(r'減ら|控え',body):changes['proactive_interval']='600';labels.append('声かけを控えめな10分間隔にした')
        minutes=re.search(r'(?<!\d)(1|3|5|10)分',body)
        if minutes:changes['proactive_interval']=str(int(minutes.group(1))*60);labels.append('声かけの間隔を'+minutes.group(1)+'分にした')
        if re.search(r'止め|やめ|なくして|停止|オフ|しない',body):changes['proactive_enabled']='false';labels.append('自動の声かけを止めた')
        elif re.search(r'再開|オン|有効|始め',body):changes['proactive_enabled']='true';labels.append('自動の声かけを有効にした')
    return {'kind':'settings','changes':changes,'labels':labels} if changes else {'kind':'help'}
